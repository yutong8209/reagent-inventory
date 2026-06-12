# 检验科试剂出入库管理系统

基于 FastAPI + SQLite 的检验科试剂全流程管理系统，支持扫码出入库、智能条码解析、库存预警、校准记录与微信移动端。

[English](README-en.md)

## 项目简介

本系统专为医疗机构检验科设计，实现试剂从入库到出库的全生命周期管理，覆盖库存实时监控、效期预警、扫码识别和移动端现场操作等核心场景。支持扫码枪/条码枪接入，兼容主流 HIS/LIS 系统数据对接需求。

### 核心场景

- 检验科试剂扫码入库（按批号、按有效期）
- 检验科试剂扫码出库（FEFO 策略 / 指定批次）
- 库存多级预警（批次效期 / 库存余量）
- 校准品/试剂更换批号记录
- 微信扫码移动端现场操作

## 技术栈

| 层级 | 技术选型 |
|------|---------|
| 后端框架 | FastAPI 0.135.3 + Uvicorn |
| 数据库 | SQLite（单文件，data/reagent.db） |
| ORM | SQLAlchemy 2.0.49（ORM + Core 双模式） |
| 数据验证 | Pydantic 2.12.5 |
| 前端 | 原生 HTML/CSS/JavaScript（SPA，无需构建） |
| 移动端 | 响应式 Web（微信内置浏览器适配） |
| 条码解析 | 自研解析引擎 + 规则学习 |
| Excel 导出 | openpyxl 3.1.5 |
| E2E 测试 | Playwright 1.54.2 |

## 核心功能

### 入库管理

- **扫码入库**：条码扫描自动识别试剂档案
- **手工入库**：支持补录未建档试剂
- **批量入库**：一次提交多条入库记录
- **批号自动关联**：入库时解析批号规则，下次扫码自动识别
- **效期预警**：入库时自动检测过期/近效期批次并提示

### 出库管理

- **扫码出库**：选择批号后扫码确认
- **FEFO 策略**：自动推荐最早效期批次
- **指定批次出库**：支持手动选择任意批次
- **批量出库**：一次选择多个试剂，确认后批量提交
- **出库预览**：提交前展示库存扣减明细（包含过期警告）

### 库存管理

- **多级状态**：正常 / 近效期 / 低库存 / 零库存 / 已过期
- **按工作组→仪器→试剂分组**：树形导航
- **按状态筛选**：支持单项筛选（正常/近效期/低库存/已过期/零库存）
- **批号明细**：展开查看每批次的效期、库存量、入库时间
- **Excel 导出**：按工作组分 Sheet，支持红黄状态高亮

### 校准管理

- **扫码校准**：扫描校准品条码，自动识别校准关系
- **新旧批号切换**：记录被校准试剂的新旧批号信息
- **校准记录**：记录 5 组校准结果数据
- **自动出库联动**：独立校准品可同步出库（自动扣减校准品库存）
- **Excel 导出**：含新旧批号对照和校准结果

### 条码解析引擎

- **GS1-128 解析**：支持 AI（01/10/17/11）结构化条码
- **精确匹配**：完整条码精确对应试剂档案
- **前缀匹配**：同一仪器下多试剂共用条码前缀
- **规则学习**：入库时自动学习批号位置规则，无需手工配置
- **产品家族推断**：通过产品码相似度推断试剂归属

### 预警系统

- **批次级效期预警**：已过期 / 距效期 N 天内
- **库存量预警**：总库存 ≤ 预警值 / 单批次库存 ≤ 预警值
- **零库存预警**：归档前实时监控零库存试剂
- **预警默认值继承**：可按仪器设置默认值，试剂自动跟随
- **批量预警设置**：一键将仪器预警值同步到下属所有试剂

### 移动端（微信轻量工作台）

- **无需安装 APP**：微信扫码即可使用
- **仪器锁定模式**：URL 参数 `?instrument_id=xxx` 锁定单一仪器，简化界面
- **快速出库**：搜索试剂 → 选择批号 → 确认出库，三步完成
- **快速入库**：搜索已有试剂 → 自动建议历史批号 → 补录入库
- **预警看板**：首页四个预警卡片（已过期/近效期/低库存/零库存），点击直达库存筛选
- **校准记录**：支持扫码校准和补录校准

### 报表功能

- **出入库流水**：按时间范围、工作组、仪器、试剂多维筛选
- **用量统计**：按月汇总各试剂出库总量
- **Excel 导出**：支持打印排版（含页眉、冻结、筛选）

### 系统管理

- **工作组管理**：组织结构管理
- **仪器管理**：预警默认值、型号信息
- **试剂档案**：匹配规则、预警设置、归档/恢复
- **试剂分组**：自定义分类（如：传染病标志物、肿瘤标志物等）
- **操作人管理**：启用/停用状态
- **管理员功能**（密码保护）：库存调整、数据重置、清空操作

## 数据库模型

```
WorkGroup (工作组)
  └── Instrument (仪器)
        ├── default_warning_days      # 默认效期预警天数
        ├── default_warning_stock      # 默认库存预警值
        └── Reagent (试剂档案)
              ├── match_mode          # exact / prefix
              ├── match_pattern        # 匹配规则
              ├── is_calibrator        # 是否校准品
              ├── follow_instrument     # 是否跟随仪器预警值
              └── BatchStock (批次库存)
                    ├── batch_no       # 批号
                    ├── expiry_date     # 效期
                    ├── quantity        # 整包装数量
                    └── loose_min_quantity  # 散装最小单位
                          └── Transaction (流水记录: IN/OUT/CALIBRATION)

CalibrationRecord (校准记录)
  ├── 校准来源 (独立校准品 / 试剂自带校准)
  ├── 新旧批号记录
  ├── 5 组校准结果
  └── 关联出库记录

BarcodeBatchRule (条码批号规则)
  ├── 仪器/试剂维度
  ├── 批号定位规则 (AI标识/偏移量/长度)
  └── 历史条码样本

ParseLog (条码解析日志)
  └── 记录每次解析的原始条码和匹配结果
```

## 快速启动

### 环境要求

- Python 3.10+
- Windows / Linux / macOS

### 启动方式

```batch
# Windows
start.bat
```

```bash
# Linux/macOS
python main.py
```

启动后访问：

- **桌面端**：`http://127.0.0.1:8000`
- **移动端**：`http://127.0.0.1:8000/m`
- **API 文档**：`http://127.0.0.1:8000/docs`

### 首次使用

系统启动时自动创建数据库表和初始化数据，包含：

- 默认试剂目录（传染病标志物等常见分组）
- 示例操作人
- 常用单位选项

## 项目结构

```
reagent-inventory/
├── main.py              # FastAPI 入口 / 路由注册
├── init_data.py         # 数据库初始化脚本
├── requirements.txt     # Python 依赖
│
├── api/                 # API 路由层
│   ├── barcode.py       # 条码解析接口
│   ├── calibration.py   # 校准管理接口
│   ├── inbound.py       # 入库接口
│   ├── inventory.py     # 库存/仪表盘/管理接口
│   ├── outbound.py      # 出库接口
│   └── reports.py       # 报表接口
│
├── models/              # SQLAlchemy 数据模型
│   ├── reagent.py        # 试剂档案
│   ├── batch_stock.py   # 批次库存
│   ├── transaction.py   # 流水记录
│   ├── calibration_record.py  # 校准记录
│   ├── barcode_batch_rule.py  # 条码规则
│   └── ...
│
├── schemas/             # Pydantic 数据模型
├── services/            # 业务服务层
│   ├── barcode_parser.py  # 条码解析引擎（核心）
│   └── *_seed.py          # 数据初始化
│
├── db/                  # 数据库连接与迁移
│   └── connection.py      # 连接管理 + 自动迁移脚本
│
├── static/              # 前端资源
│   ├── index.html        # 桌面端页面
│   ├── mobile.html       # 移动端页面
│   └── js/
│       ├── main.js      # 桌面端逻辑
│       ├── mobile.js     # 移动端逻辑 (mobileApp)
│       ├── api.js        # API 客户端封装
│       ├── utils.js      # 工具函数库
│       └── pages/        # 页面模块化组件
│
├── scripts/             # PowerShell 运维脚本
├── tests/               # 测试
│   ├── test_*.py        # 单元/集成测试 (pytest)
│   └── e2e/             # Playwright E2E 测试
│
└── data/                # 数据库文件目录
    └── reagent.db        # SQLite 数据库
```

## 主要 API 端点

### 库存

- `GET /api/inventory` — 库存数据（按工作组/仪器/试剂分组）
- `GET /api/dashboard/overview` — 仪表盘概览
- `GET /api/mobile/overview` — 移动端概览

### 入库

- `POST /api/inbound/batch` — 批量入库
- `POST /api/reagents` — 新建试剂档案

### 出库

- `GET /api/outbound/reagents` — 搜索可出库试剂
- `POST /api/outbound/preview` — 出库预览（FEFO 计算）
- `POST /api/outbound/batch` — 批量出库确认

### 校准

- `POST /api/calibration/scan-preview` — 扫码预览
- `POST /api/calibration/records` — 创建校准记录
- `GET /api/calibration/records` — 校准记录列表

### 报表

- `GET /api/transactions` — 流水查询
- `GET /api/usage` — 用量统计
- `GET /api/transactions/export` — 导出流水 Excel
- `GET /api/inventory/export` — 导出库存 Excel

### 条码解析

- `POST /api/barcode/parse` — 解析条码（返回试剂/批号/效期）

### 管理

- `GET/POST/PUT/DELETE /api/work-groups` — 工作组 CRUD
- `GET/POST/PUT/DELETE /api/instruments` — 仪器 CRUD
- `GET/POST/PUT/DELETE /api/reagents` — 试剂档案 CRUD
- `POST /api/admin/stock-adjustments/apply` — 库存调整（需管理员密码）

## 配置说明

### 管理员密码

管理员操作（库存调整、数据重置）需要密码验证，默认密码在 `api/inventory.py` 中配置。

### 效期预警默认值

仪器级可设置默认预警值，试剂级可单独覆盖或跟随仪器默认值。

### 移动端仪器锁定

通过 URL 参数锁定单一仪器，简化操作界面：

```
http://your-server/m?instrument_id=5
```

锁定后仅显示该仪器数据，出入库无需选择仪器。

## 测试

```bash
# 运行所有测试
npm run test:all

# Playwright E2E 测试
npm run test:e2e

# 带 UI 的 E2E 测试
npm run test:e2e:ui
```

## 许可证

本项目仅供内部使用，禁止外传。
