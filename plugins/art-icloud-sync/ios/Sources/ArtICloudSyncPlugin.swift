//
//  ArtICloudSyncPlugin.swift
//  アトリコ（画材の在庫を管理するアプリ）用のiCloud自動バックアップ。
//
//  NSUbiquitousKeyValueStore（iCloudのキー・バリュー保存）に、アプリの状態（在庫・
//  フォルダ・設定）を1つの文字列として置く。アプリを削除しても、同じApple IDで
//  入れ直せば、起動時にここから戻せる。
//
//  JavaScript 側（icloud.js）は Capacitor.Plugins.ArtICloudSync として
//      const { available } = await ArtICloudSync.status()
//      const { value } = await ArtICloudSync.read({ key })
//      await ArtICloudSync.write({ key, value })
//  の形で呼ぶ。
//
//  必要になる設定: App ID の iCloud（キー・バリュー保存）Capability と、
//  entitlements の com.apple.developer.ubiquity-kvstore-identifier
//  （scripts/configure-ios.mjs が App.entitlements を作り、Xcode に渡す）。
//

import Foundation
import Capacitor

@objc(ArtICloudSyncPlugin)
public class ArtICloudSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ArtICloudSyncPlugin"
    public let jsName = "ArtICloudSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise)
    ]

    private var observer: NSObjectProtocol?
    /// iCloudのキー・バリュー保存（アプリ全体で1つ）
    private var store: NSUbiquitousKeyValueStore { NSUbiquitousKeyValueStore.default }

    override public func load() {
        // 起動時に、別の端末で書かれた分を取り込む
        _ = store.synchronize()
        observer = NotificationCenter.default.addObserver(
            forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
            object: store,
            queue: .main
        ) { [weak self] note in
            let info = note.userInfo ?? [:]
            let reason = info[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int ?? -1
            let keys = info[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
            // JS側は addListener('remoteChange') で受け取る（黙って上書きはしない）
            self?.notifyListeners("remoteChange", data: ["reason": reason, "keys": keys])
        }
    }

    deinit {
        if let observer = observer {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    /// iCloudにサインインしているか（していなければ何も書かれない）
    @objc func status(_ call: CAPPluginCall) {
        let signedIn = FileManager.default.ubiquityIdentityToken != nil
        let synchronized = store.synchronize()
        call.resolve([
            "available": signedIn,
            "signedIn": signedIn,
            "reason": signedIn ? "" : "no-account",
            "synchronized": synchronized
        ])
    }

    /// 保存している文字列を読む（無ければ空文字）
    @objc func read(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key がありません")
            return
        }
        let value = store.string(forKey: key) ?? ""
        call.resolve(["value": value, "bytes": value.utf8.count])
    }

    /// 文字列を保存する。大きさはJS側で見ているが、念のため空文字は書かない
    @objc func write(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key がありません")
            return
        }
        guard let value = call.getString("value"), !value.isEmpty else {
            call.reject("value がありません")
            return
        }
        store.set(value, forKey: key)
        let synchronized = store.synchronize()
        call.resolve([
            "ok": true,
            "synchronized": synchronized,
            "bytes": value.utf8.count
        ])
    }

    /// 保存を消す（全データ削除のときに使う）
    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("key がありません")
            return
        }
        store.removeObject(forKey: key)
        call.resolve(["ok": true, "synchronized": store.synchronize()])
    }

    /// すぐにiCloudと同期する（アプリが裏に回るとき等）
    @objc func sync(_ call: CAPPluginCall) {
        call.resolve(["synchronized": store.synchronize()])
    }
}
