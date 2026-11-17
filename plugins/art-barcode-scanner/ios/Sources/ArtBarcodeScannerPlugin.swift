//
//  ArtBarcodeScannerPlugin.swift
//  アトリコ（画材の在庫を管理するアプリ）用のバーコード読取。
//
//  iOS の AVFoundation（AVCaptureSession + AVCaptureMetadataOutput）で、カメラの映像を
//  1コマずつ JavaScript で解析するのではなく、端末のハードウェアで JAN（EAN-13 など）を
//  その場で認識する。認識した瞬間に1本を返すので、画面を閉じ直さずに続けて読める。
//
//  JavaScript 側（app.js / scanner.js）は Capacitor.Plugins.BarcodeScanner として
//    const { barcodes } = await BarcodeScanner.startScan({ formats: [...], camera: 'environment' })
//  の形で呼び、barcodes[0].rawValue に読取値が入る。
//

import Foundation
import UIKit
import AVFoundation
import Capacitor

@objc(ArtBarcodeScannerPlugin)
public class ArtBarcodeScannerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ArtBarcodeScannerPlugin"
    public let jsName = "BarcodeScanner"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise)
    ]

    /// いま開いているカメラ画面（連続スキャンの間はこの1枚を使い回す）
    private var scanner: ArtBarcodeScannerController?
    /// いま待っている1本（読み取ったら resolve、閉じたら reject する）
    private var activeCall: CAPPluginCall?

    // MARK: - JS から呼ばれるメソッド

    @objc func isSupported(_ call: CAPPluginCall) {
        let hasCamera = AVCaptureDevice.default(for: .video) != nil
        call.resolve(["supported": hasCamera])
    }

    @objc func setStatus(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? ""
        let count = call.getInt("count") ?? -1
        DispatchQueue.main.async { [weak self] in
            self?.scanner?.applyStatus(message: message, count: count)
        }
        call.resolve()
    }

    @objc func stopScan(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.resolve()
                return
            }
            self.dismissScanner(rejectPending: "stopped", message: "読み取りを止めました")
            call.resolve()
        }
    }

    @objc func startScan(_ call: CAPPluginCall) {
        let formats = call.getArray("formats", String.self) ?? []
        let camera = call.getString("camera") ?? "environment"
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.activeCall = call
            // すでにカメラ画面が開いている（連続スキャン）→ 開き直さず、そのまま次の1本を待つ
            if let open = self.scanner, open.presentingViewController != nil {
                return
            }
            self.presentScanner(formats: formats, camera: camera, attempt: 0)
        }
    }

    // MARK: - カメラ画面

    private func presentScanner(formats: [String], camera: String, attempt: Int) {
        guard let host = self.bridge?.viewController else {
            rejectActive("カメラを開けません")
            return
        }
        // 前の画面が閉じている途中なら、少し待ってから開く（重なって開けない）
        if host.presentedViewController != nil && attempt < 4 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
                self?.presentScanner(formats: formats, camera: camera, attempt: attempt + 1)
            }
            return
        }
        let controller = ArtBarcodeScannerController()
        controller.requestedFormats = formats
        controller.cameraPosition = (camera == "user") ? .front : .back
        controller.onCode = { [weak self] value, format in
            guard let self = self, let pending = self.activeCall else { return }
            self.activeCall = nil
            pending.resolve(["barcodes": [["rawValue": value, "displayValue": value, "format": format]]])
        }
        controller.onClose = { [weak self] in
            guard let self = self else { return }
            self.scanner = nil
            self.rejectActive("読み取りをやめました")
        }
        self.scanner = controller
        self.bridge?.presentVC(controller, animated: false, completion: nil)
    }

    private func dismissScanner(rejectPending: String, message: String) {
        if let pending = self.activeCall {
            self.activeCall = nil
            pending.reject(message, rejectPending)
        }
        let closing = self.scanner
        self.scanner = nil
        closing?.stopSession()
        self.bridge?.dismissVC(animated: false, completion: nil)
    }

    private func rejectActive(_ message: String) {
        guard let pending = self.activeCall else { return }
        self.activeCall = nil
        pending.reject(message, "cancelled")
    }
}

// MARK: - カメラ画面（プレビュー・読み取り枠・閉じる・カメラ切替）

final class ArtBarcodeScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var requestedFormats: [String] = []
    var cameraPosition: AVCaptureDevice.Position = .back
    var onCode: ((String, String) -> Void)?
    var onClose: (() -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "com.shodai4.artsupplymanager.barcode")
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var metadataOutput: AVCaptureMetadataOutput?
    private var isConfigured = false
    private var lastValue = ""
    private var lastAt = Date.distantPast

    private let statusLabel = UILabel()
    private let countLabel = UILabel()
    private let closeButton = UIButton(type: .system)
    private let flipButton = UIButton(type: .system)
    private let reticle = UIView()
    private let bottomBar = UIView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupOverlay()
        prepareCamera()
        NotificationCenter.default.addObserver(
            self, selector: #selector(appWillEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil
        )
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startSession()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopSession()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    // MARK: - 画面の組み立て

    private func setupOverlay() {
        reticle.translatesAutoresizingMaskIntoConstraints = false
        reticle.layer.borderColor = UIColor.white.withAlphaComponent(0.85).cgColor
        reticle.layer.borderWidth = 2
        reticle.layer.cornerRadius = 12
        reticle.isUserInteractionEnabled = false
        view.addSubview(reticle)

        bottomBar.translatesAutoresizingMaskIntoConstraints = false
        bottomBar.backgroundColor = UIColor(white: 0, alpha: 0.55)
        view.addSubview(bottomBar)

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.text = "枠内にバーコードを入れてください"
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 2
        bottomBar.addSubview(statusLabel)

        countLabel.translatesAutoresizingMaskIntoConstraints = false
        countLabel.textColor = UIColor(white: 1, alpha: 0.85)
        countLabel.font = .systemFont(ofSize: 12, weight: .regular)
        countLabel.textAlignment = .center
        countLabel.isHidden = true
        bottomBar.addSubview(countLabel)

        setupButton(closeButton, symbol: "xmark", label: "閉じる", action: #selector(closeTapped))
        setupButton(flipButton, symbol: "arrow.triangle.2.circlepath.camera", label: "カメラを切り替え", action: #selector(flipTapped))
        view.addSubview(closeButton)
        view.addSubview(flipButton)

        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            reticle.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -36),
            reticle.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.84),
            reticle.heightAnchor.constraint(equalToConstant: 132),

            closeButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 10),
            closeButton.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -16),
            closeButton.widthAnchor.constraint(equalToConstant: 44),
            closeButton.heightAnchor.constraint(equalToConstant: 44),

            flipButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 10),
            flipButton.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 16),
            flipButton.widthAnchor.constraint(equalToConstant: 44),
            flipButton.heightAnchor.constraint(equalToConstant: 44),

            bottomBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            bottomBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            bottomBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            bottomBar.heightAnchor.constraint(equalToConstant: 104),

            statusLabel.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor, constant: -20),
            statusLabel.topAnchor.constraint(equalTo: bottomBar.topAnchor, constant: 20),

            countLabel.leadingAnchor.constraint(equalTo: bottomBar.leadingAnchor, constant: 20),
            countLabel.trailingAnchor.constraint(equalTo: bottomBar.trailingAnchor, constant: -20),
            countLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 6)
        ])
    }

    private func setupButton(_ button: UIButton, symbol: String, label: String, action: Selector) {
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setImage(UIImage(systemName: symbol), for: .normal)
        button.tintColor = .white
        button.backgroundColor = UIColor(white: 0, alpha: 0.45)
        button.layer.cornerRadius = 22
        button.accessibilityLabel = label
        button.addTarget(self, action: action, for: .touchUpInside)
    }

    // MARK: - カメラ

    private func prepareCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    if granted {
                        self.configureSession()
                        self.startSession()
                    } else {
                        self.showCameraMessage("カメラの使用が許可されていません。設定 › アトリコ で許可してください。")
                    }
                }
            }
        default:
            showCameraMessage("カメラの使用が許可されていません。設定 › アトリコ で許可してください。")
        }
    }

    private func configureSession() {
        guard !isConfigured else { return }
        guard let device = cameraDevice(position: cameraPosition),
              let input = try? AVCaptureDeviceInput(device: device) else {
            showCameraMessage("カメラを開けませんでした。手入力をお使いください。")
            return
        }
        session.beginConfiguration()
        session.sessionPreset = .high
        if session.canAddInput(input) {
            session.addInput(input)
        }
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            let available = output.availableMetadataObjectTypes
            let wanted = wantedObjectTypes().filter { available.contains($0) }
            output.metadataObjectTypes = wanted.isEmpty ? [AVMetadataObject.ObjectType.ean13] : wanted
            metadataOutput = output
        }
        session.commitConfiguration()

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
        isConfigured = true
    }

    /// 読む種類（JAN の EAN-13 を基本に、EAN-8・UPC-E・CODE128 も受ける）
    private func wantedObjectTypes() -> [AVMetadataObject.ObjectType] {
        let map: [String: AVMetadataObject.ObjectType] = [
            "EAN_13": AVMetadataObject.ObjectType.ean13,
            "EAN_8": AVMetadataObject.ObjectType.ean8,
            "UPC_A": AVMetadataObject.ObjectType.ean13,
            "UPC_E": AVMetadataObject.ObjectType.upce,
            "CODE_128": AVMetadataObject.ObjectType.code128,
            "QR_CODE": AVMetadataObject.ObjectType.qr
        ]
        var types: [AVMetadataObject.ObjectType] = []
        for name in requestedFormats {
            if let type = map[name], !types.contains(type) {
                types.append(type)
            }
        }
        if types.isEmpty {
            return [AVMetadataObject.ObjectType.ean13, AVMetadataObject.ObjectType.ean8,
                    AVMetadataObject.ObjectType.upce, AVMetadataObject.ObjectType.code128]
        }
        return types
    }

    private func cameraDevice(position: AVCaptureDevice.Position) -> AVCaptureDevice? {
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) {
            return device
        }
        return AVCaptureDevice.default(for: .video)
    }

    func startSession() {
        guard isConfigured else { return }
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            if !self.session.isRunning {
                self.session.startRunning()
            }
        }
    }

    func stopSession() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            if self.session.isRunning {
                self.session.stopRunning()
            }
        }
    }

    @objc private func appWillEnterForeground() {
        startSession()
    }

    // MARK: - 読み取り

    func metadataOutput(_ output: AVCaptureMetadataOutput,
                        didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        for object in metadataObjects {
            guard let code = object as? AVMetadataMachineReadableCodeObject,
                  let value = code.stringValue,
                  !value.isEmpty else { continue }
            let now = Date()
            // 同じバーコードが画面に残っている間の連打を抑える（別のJANはすぐ通す）
            if value == lastValue && now.timeIntervalSince(lastAt) < 0.8 { continue }
            lastValue = value
            lastAt = now
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onCode?(value, typeName(code.type))
            return
        }
    }

    private func typeName(_ type: AVMetadataObject.ObjectType) -> String {
        if type == AVMetadataObject.ObjectType.ean13 { return "EAN_13" }
        if type == AVMetadataObject.ObjectType.ean8 { return "EAN_8" }
        if type == AVMetadataObject.ObjectType.upce { return "UPC_E" }
        if type == AVMetadataObject.ObjectType.code128 { return "CODE_128" }
        if type == AVMetadataObject.ObjectType.qr { return "QR_CODE" }
        return "UNKNOWN"
    }

    // MARK: - 画面の操作

    @objc private func closeTapped() {
        stopSession()
        dismiss(animated: false) { [weak self] in
            self?.onClose?()
        }
    }

    @objc private func flipTapped() {
        sessionQueue.async { [weak self] in
            guard let self = self,
                  let current = self.session.inputs.first as? AVCaptureDeviceInput else { return }
            let next: AVCaptureDevice.Position = current.device.position == .front ? .back : .front
            guard let device = self.cameraDevice(position: next),
                  let input = try? AVCaptureDeviceInput(device: device) else { return }
            self.session.beginConfiguration()
            self.session.removeInput(current)
            if self.session.canAddInput(input) {
                self.session.addInput(input)
            } else {
                self.session.addInput(current)
            }
            self.session.commitConfiguration()
        }
    }

    // MARK: - 案内の文字

    func applyStatus(message: String, count: Int) {
        if !message.isEmpty {
            statusLabel.text = message
        }
        if count >= 0 {
            countLabel.text = "読取 \(count)件"
            countLabel.isHidden = false
        }
    }

    private func showCameraMessage(_ text: String) {
        statusLabel.text = text
        countLabel.isHidden = true
    }
}
