<p align="right"><a href="README.md">English</a></p>

<h1 align="center">Bridge</h1>
<p align="center">统一的桌面调试工具箱，支持 Android（ADB）、OpenHarmony（HDC）和串口设备</p>

<p align="center">
  <img src="app-icon.png" width="96" alt="Bridge 图标" />
</p>

<p align="center">
  <img alt="版本" src="https://img.shields.io/badge/版本-0.3.1-blue" />
  <img alt="平台" src="https://img.shields.io/badge/平台-Windows-lightgrey" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-orange" />
  <img alt="React" src="https://img.shields.io/badge/React-18-61DAFB" />
</p>

---

Bridge 是一款 Windows 桌面应用，将 ADB Android 设备管理、OHOS（鸿蒙 / OpenHarmony）设备管理以及串口 / Telnet 调试整合到同一个界面中，彻底告别多窗口切换的繁琐操作。

---

## 功能特性

### Android（ADB）

| 功能 | 说明 |
|------|------|
| **设备管理** | 实时设备列表，显示连接状态，自动检测 root / 重挂载 |
| **文件管理器** | 浏览设备文件系统，支持上传/下载（带进度）、删除、内置文件查看器（文本 & 十六进制）|
| **Logcat** | 实时日志流，支持 Tag / Level / 关键字过滤，可导出到文件 |
| **应用管理器** | 列出已安装应用包（用户 + 系统），支持安装 APK、卸载/停用、强制停止、清除数据 |
| **屏幕镜像** | 启动 [scrcpy](https://github.com/Genymobile/scrcpy)，支持分辨率、码率、方向、录制等配置，面板内置方向键 / 功能键遥控器 |
| **Shell** | 流式交互 Shell，带输出缓冲区、文件日志记录和快捷命令面板 |

### OHOS / 鸿蒙（HDC）

| 功能 | 说明 |
|------|------|
| **设备管理** | 实时设备列表（USB + TCP），连接时自动重挂载，每台设备显示挂载状态 |
| **文件管理器** | 浏览、上传、下载、删除——与 ADB 模块体验一致 |
| **HiLog / tlogcat** | 双模式日志流（HiLog 和 tlogcat），支持等级 / 关键字过滤与导出 |
| **应用管理器** | 列出所有 HAP 应用包及类型分类（用户/product/vendor/系统），支持安装 HAP、卸载、强制停止、清除数据 |
| **屏幕镜像** | 应用内截屏，帧率可配置（0.2–3 fps），通过 `snapshot_display` 抓取 JPEG 帧并直接显示在面板中 |
| **Shell** | 与 ADB 共用统一 Shell |

### 串口 / Telnet

| 功能 | 说明 |
|------|------|
| **终端** | 完整的 xterm.js 终端，波特率可配置，支持 ANSI 颜色与转义序列 |
| **Telnet** | 连接任意 host:port，自动处理 IAC 控制序列 |
| **快捷命令** | 持久化命令面板，一键保存、整理和发送命令 |
| **序列执行器** | 按顺序循环执行快捷命令列表，间隔时间可配置 |
| **日志导出** | 快照当前输出缓冲，或持续将日志写入文件 |

### 通用功能

- **统一设备侧边栏** — ADB、OHOS 和串口设备全部列在同一列表，一键切换上下文
- **共享遥控器面板** — 方向键、Home / Back / Menu、音量 +/−/ 电源按键，同时支持 ADB 和 OHOS 屏幕镜像
- **每设备独立输出缓冲** — 切换设备时不会丢失终端或日志历史
- **持久化配置** — 主题、连接默认值、快捷命令和设置在重启后保留
- **深色主题** — 基于 Ant Design 5 深色 Token 全面适配

---

## 环境要求

| 依赖 | 说明 |
|------|------|
| **Windows 10/11** | 目前仅支持 Windows 平台 |
| **ADB** | 发布版本中已打包至 `src-tauri/resources/adb/`；开发模式下需在 PATH 中 |
| **HDC（hdc.exe）** | OHOS 功能必需 — 安装 [DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/) 或将 `hdc` 加入 PATH |
| **scrcpy** | ADB 屏幕镜像必需 — 从 [scrcpy releases](https://github.com/Genymobile/scrcpy/releases) 安装并加入 PATH |

---

## 安装

> **暂未发布预构建安装包。** 请参照以下说明从源码构建。

---

## 从源码构建

### 前置条件

- [Node.js](https://nodejs.org/) ≥ 18
- [Rust](https://www.rust-lang.org/tools/install) stable 工具链
- [Tauri CLI](https://tauri.app/v2/start/prerequisites/)：`cargo install tauri-cli`

### 步骤

```bash
# 克隆仓库
git clone https://github.com/your-org/bridge.git
cd bridge

# 安装前端依赖
npm install

# 开发模式运行（Vite 开发服务器 + Tauri 窗口）
npm run tauri dev

# 构建生产安装包
npm run tauri build
```

### 常用开发命令

```bash
# 仅进行前端类型检查
npx tsc --noEmit

# 仅检查/构建 Rust 后端
cd src-tauri && cargo check
cd src-tauri && cargo build
```

---

## 技术栈

| 层次 | 技术 |
|------|------|
| **前端** | React 18、TypeScript、Ant Design 5（深色主题）、Zustand、xterm.js、react-resizable-panels |
| **后端** | Rust、Tokio（异步运行时）、serialport 4、once_cell |
| **桥接层** | Tauri 2（`tauri-plugin-shell`、`tauri-plugin-dialog`、`tauri-plugin-fs`、`tauri-plugin-store`）|
| **构建工具** | Vite、Cargo |

---

## 文档

完整的 API 参考和设计文档位于 [`docs/`](docs/) 目录：

| 文档 | 说明 |
|------|------|
| [设计文档](docs/CN/Bridge%20%E2%80%94%20%E8%AE%BE%E8%AE%A1%E6%96%87%E6%A1%A3.md) | 架构设计、模块设计、功能规格、界面布局 |
| [ADB 模块 API 参考](docs/CN/ADB%20%E6%A8%A1%E5%9D%97%20API%20%E5%8F%82%E8%80%83.md) | 所有 ADB Tauri 命令、事件和数据类型 |
| [OHOS 模块 API 参考](docs/CN/OHOS%20%E6%A8%A1%E5%9D%97%20API%20%E5%8F%82%E8%80%83.md) | 所有 HDC/OHOS Tauri 命令、事件和数据类型 |
| [串口模块 API 参考](docs/CN/%E4%B8%B2%E5%8F%A3%E6%A8%A1%E5%9D%97%20API%20%E5%8F%82%E8%80%83.md) | 串口和 Telnet 命令、事件及状态模型 |

英文版文档请参阅 [`docs/EN/`](docs/EN/)。

---

## 项目结构

```
Bridge/
├── src-tauri/          # Rust 后端
│   ├── src/
│   │   ├── adb/        # ADB 设备、文件、logcat、应用、scrcpy
│   │   ├── hdc/        # OHOS 设备、文件、HiLog、应用、屏幕镜像
│   │   ├── serial/     # 串口 + Telnet 管理器
│   │   └── lib.rs      # 命令注册与应用初始化
│   └── resources/      # 打包的 ADB 二进制文件
├── src/                # React 前端
│   ├── components/
│   │   ├── adb/        # ADB 专属面板
│   │   ├── hdc/        # OHOS 专属面板
│   │   ├── shared/     # 共享组件（RemoteControlPanel、UploadModal）
│   │   └── layout/     # 侧边栏、状态栏、连接弹窗
│   ├── hooks/          # Tauri 事件订阅
│   ├── store/          # Zustand 状态存储
│   └── utils/          # invoke() 封装函数
└── docs/
    ├── EN/             # 英文文档
    └── CN/             # 中文文档
```

---

## 许可证

本项目尚未以公开许可证发布，保留所有权利。
