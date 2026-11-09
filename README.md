# 砚录

砚录是一个只做文字识别的离线应用。它在你自己的设备上读取图片里的简体中文和英文（也可以混排），把结果按阅读顺序放进可编辑的文本框，支持一键复制和导出 `.txt`。

图片和识别结果不会上传。运行时不访问识别接口、不加载远程模型、不发送统计。

## 安装

发布包在 `release/`（本地构建）以及 CI 的 artifacts 里。

| 平台 | 用什么 | 文件 |
| --- | --- | --- |
| 电脑浏览器 | 静态站点 | `release/yanlu-pwa.zip` |
| iPhone / iPad | 同一个 PWA，添加到主屏幕 | `release/yanlu-pwa.zip` |
| Android | 调试签名 APK，或同一个 PWA | `release/yanlu-debug.apk` |
| Windows | 免安装压缩包，解压后运行 `Yanlu.exe` | `release/desktop/Yanlu-1.0.0-windows.zip` |
| Linux | AppImage | `release/desktop/Yanlu-1.0.0-linux.AppImage` |
| macOS | 未签名 dmg 需在 macOS 上由 CI 构建；平时可直接用 PWA | CI job `macos` |

### 电脑上的网页 / PWA

把 `yanlu-pwa.zip` 解压到任意静态目录，用本地静态服务器打开（开发时也可以 `npm run dev`）。

安装成应用：Chrome / Edge 地址栏的「安装」，或菜单里的「安装砚录」。安装完成后可以断网使用。页面带有严格的 `Content-Security-Policy`，`connect-src` 只有 `'self'`。

### iPhone 和 iPad

这里没有可用的 Apple 签名，所以不提供 ipa。请用 PWA：

1. 把 `yanlu-pwa.zip` 放到一次 **HTTPS** 网站上（iOS 只允许从 HTTPS 或 localhost 安装主屏幕应用）。对象存储、GitHub Pages、自己的 Nginx 都可以。这一步只为了把应用文件下载到手机，不是把照片传上去。
2. 用 **Safari** 打开该地址。
3. 分享按钮 → **添加到主屏幕**。
4. 打开主屏幕上的「砚录」，等模型第一次加载完（约 40MB）。之后可以开飞行模式继续用。
5. 拍照用页面上的「拍照」。选相册用「选择图片」。

如果换了新版本，用 Safari 再打开一次同一地址，让 Service Worker 更新缓存。

### Android

1. 把 `yanlu-debug.apk` 拷到手机。
2. 允许安装未知来源应用，点安装。这是调试证书签名的包，系统会提示。
3. 打开「砚录」。第一次识别会从应用内部读模型，不需要网络。
4. 「拍照」会调用相机；「选择图片」走系统相册。

也可以用上面的 PWA：Chrome 菜单 → 「安装应用」或「添加到主屏幕」。

### Windows

若你拿到的是完整的 `Yanlu-1.0.0-windows.zip`，解压后运行 `Yanlu.exe`。包没有微软签名，SmartScreen 可能拦截，选择仍要运行即可。

若下载到的是分卷（`Yanlu-windows.7z.01` 起），把所有分卷、`reassemble-windows.bat` 放在同一文件夹，双击 bat。它会拼出 `Yanlu-windows.7z`。再用 7-Zip 解压，运行里面的 `Yanlu.exe`。7-Zip：https://www.7-zip.org/

### Linux

完整 AppImage：

```bash
chmod +x Yanlu-1.0.0-linux.AppImage
./Yanlu-1.0.0-linux.AppImage
```

若系统没有 FUSE，可以 `./Yanlu-1.0.0-linux.AppImage --appimage-extract-and-run`。

分卷（`Yanlu-linux.7z.01` 起）放在同一目录后：

```bash
chmod +x reassemble-linux.sh
./reassemble-linux.sh
7z x Yanlu-linux.7z
chmod +x yanlu
./yanlu
```

### macOS

Linux 不能交叉编译 macOS 桌面安装包。仓库里的 GitHub Actions（`.github/workflows/release.yml`）在 `macos-latest` 上生成未签名 dmg。没装证书时，第一次打开需要在「隐私与安全性」里允许。平时用 PWA 即可，Chrome 或 Safari 都能安装。

## 怎么用

- 选择图片、拍照、把图片拖进窗口，或在电脑上直接粘贴截图（Ctrl/Cmd+V）。
- 识别过程中有进度条。
- 结果可以改，然后复制或导出 `砚录-识别结果.txt`（UTF-8，带 BOM，记事本不会乱码）。
- 「显示检测框」会在图上画出文字区域。

大图会在送入模型前把长边限制在 4096 像素以内。检测在长边不超过 960 的尺度上找框，识别用原图（或这张缩小后的图）上的文字块，所以手机拍的文档也能读。

横竖颠倒的页面会先按文字行方向转正，倒过来的行会再转 180 度，然后按从上到下、从左到右输出。

## 隐私

这些限制写在程序里，不靠约定：

- 模型、字典、图标、WASM 都打进安装包或 PWA 包。运行时不会向模型站或 CDN 发请求。
- 正式页面的 CSP：`connect-src 'self'`，脚本只允许 `'self'` 和 `'wasm-unsafe-eval'`。
- 正式构建会拦截 `fetch`、`XMLHttpRequest`、`WebSocket`、`sendBeacon` 的跨源调用。
- Service Worker 拒绝非本源请求，并缓存本源文件，便于断网打开。
- 没有账号、没有统计、没有崩溃上报。
- 桌面版用 `app://` 协议只读本地 `dist`，渲染进程不开 Node。
- Android 清单里的 `INTERNET` 是系统 WebView 加载应用内资源所需要的；页面自身会拒绝一切非本机请求。`CAMERA` 只在你点拍照时使用。

`npm test` 里的源码扫描会拒绝 `src/`、`electron/`、`index.html` 中的外部 URL。`npm run test:network` 用浏览器打开正式构建，对一张中英混合样图做识别，并断言期间没有任何非本机请求。

## 准确率

引擎是 PaddleOCR **PP-OCRv5 mobile**：检测 `ch_PP-OCRv5_det_mobile`、方向 `ch_PP-LCNet_x0_25_textline_ori`、识别 `ch_PP-OCRv5_rec_mobile`，字典 `ppocrv5_dict.txt`（18383 字，外加 CTC blank 和空格）。测试图由 Noto Sans CJK SC 渲染，含单行混排、多行、段落、小字、低对比、约 8 度倾斜，以及 90/180/270 度旋转。

在本仓库的 10 张图上（`npm test`）：

- 去掉空白并做 NFKC 归一后的字符准确率：**100%**（加权平均）。
- 保留空格和换行的严格字符准确率：**97.78%**。差距主要是模型吞掉了中英文交界处的空格，以及倾斜图上两行被并成一行。

这是清晰印刷体上的结果，不是任意拍照场景的保证。模糊、手写、严重反光仍会出错。

## 从源码运行

需要 Node.js 22。

```bash
npm ci
npm test
npm run dev
```

开发服务器在 <http://127.0.0.1:43123> 。

```bash
npm run build          # dist/
npm run dist:pwa       # release/yanlu-pwa.zip
npm run dist:desktop   # Linux AppImage 与 Windows zip
npm run test:network   # 需要已安装的 Playwright Chromium
```

Android 调试包（本机需要 Android SDK 36 与 JDK 21）：

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

APK 在 `android/app/build/outputs/apk/debug/`。

重新生成测试图需要本机的 Noto Sans CJK：

```bash
python3 scripts/generate-fixtures.py
```

## 模型来源与校验

ONNX 文件来自 RapidAI/RapidOCR 在 ModelScope 上的 **v3.10.0** 发布，SHA-256 与上游 `default_models.yaml` 一致。字典与 PaddleOCR 仓库中的 `ppocr/utils/dict/ppocrv5_dict.txt` 逐字节相同。

| 文件 | SHA-256 |
| --- | --- |
| `ch_PP-OCRv5_det_mobile.onnx` | `4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae` |
| `ch_PP-OCRv5_rec_mobile.onnx` | `5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5` |
| `ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx` | `54379ae5174d026780215fc748a7f31910dee36818e63d49e17dc598ecc82df7` |
| `ppocrv5_dict.txt` | `d1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b` |

```bash
npm run verify:models
```

下载地址（只在准备模型时使用，应用运行时不会访问）：

- https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/det/ch_PP-OCRv5_det_mobile.onnx
- https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/rec/ch_PP-OCRv5_rec_mobile.onnx
- https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/cls/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx
- https://github.com/PaddlePaddle/PaddleOCR/blob/main/ppocr/utils/dict/ppocrv5_dict.txt

## 许可证

应用自己的界面和推理胶水代码以 MIT 许可发布，见 `LICENSE`。随包分发的第三方组件见 `NOTICE`：

- PaddleOCR 模型与字典：Apache-2.0
- RapidOCR（模型导出与算法说明）：Apache-2.0
- ONNX Runtime 1.31.1：MIT
- clipper-lib：Boost Software License 1.0
- 测试图用的 Noto Sans CJK：SIL OFL 1.1，字体未打进应用

## 需要你自己完成的事

- **iOS 安装**：把 PWA 用 HTTPS 打开一次，再用 Safari 添加到主屏幕。没有 Apple 开发者证书就做不了 App Store 包。
- **macOS 安装包**：在 macOS 上跑 CI，或直接用 PWA。未签名应用要在系统设置里放行。
- **Windows**：zip 里的 exe 没有代码签名。
- **Android**：当前 APK 是调试签名。要上架需要你自己的上传密钥，再执行 `assembleRelease`。
