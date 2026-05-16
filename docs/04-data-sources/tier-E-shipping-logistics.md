# Tier E — 船舶 / 港口 / 物流

适合"看物流状态"，不适合"判断谁买了谁的货"。MVP 不接入；Phase 3 起视需要接入。

## E.1 NOAA AccessAIS (`noaa-ais`)

### 用途

- 美国水域船舶 AIS 历史数据
- 自定义地理区域 + 时间段下载
- 提供 traffic pattern / vessel count 可视化

### 接入

- 网页选区下载 CSV
- AccessAIS 提供 bulk file（按月 / 区域）
- 大文件（年度全量约 80 GB）

### 用法

- 港口级吞吐量信号
- 拥堵 / dwell time 信号
- 特定航线 vessel count 趋势

### 反模式

- "这艘船上有 NVIDIA H100" —— **AIS 不告诉你货物**，禁止此类推断
- "这批货属于 Apple" —— 同上

## E.2 港口 dashboards

- Port of Los Angeles / Long Beach 数据 dashboard
- Port of Rotterdam / Singapore / Shanghai 等
- 各港口公开数据格式不一

### 用法

- 月度吞吐
- 拥堵指数
- 特定航线船舶等待时间

### 接入策略

- 各自独立 adapter（沿用 source-adapter spec）
- 仅作 macro signal，不进图谱

## E.3 航运公司公告（schedule / port call）

- 班轮公司（Maersk、MSC、CMA CGM、HMM、Evergreen 等）发布 schedule
- 部分公开，部分需注册

### 用法

- 验证特定航线运行情况
- 不进图谱

## E.4 MarineCadastre AIS

- 美国 NOAA / BOEM 等机构联合的 AIS 与海洋数据
- 与 AccessAIS 部分重叠

## 共同要求

- 数据极易被噪声主导（船关 AIS、商船商船重名、信号丢失）
- 必须严格控制信号的"用法范围"——只用于宏观，不下到公司层

## 关系类型规划（Phase 3+）

| relation        | 主体    | 客体   | 数据源        |
| --------------- | ----- | ---- | ---------- |
| `OWNS_VESSEL`   | 船东    | 船舶   | LR / IHS / 公开 ITU MMSI register |
| `OPERATES_VESSEL` | 运营人  | 船舶   | 公开班轮公告      |
| `CALLS_PORT`    | 船舶    | 港口   | AIS（聚合后）   |
| `CARRIES_FOR`   | 承运商   | 货主   | 推断（多源）      |

不在 MVP 范围；写在这里只是为了 schema 提前对齐。

## MVP 阶段的暂行做法

物流相关的研究在 MVP 阶段**全部走手工记录**：

```
supplystrata manual evidence add \
  --doc <pdf-or-url> \
  --cite "..." \
  --source-type IR \
  --note "logistics narrative; no edges generated"
```

即用证据卡片承载，不强行建结构化边。
