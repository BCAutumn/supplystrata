# CBP Manifest Confidentiality

美国海关与边境保护局（CBP）允许 importer / consignee / shipper 对其在 vessel manifest 上的名称与地址申请保密（manifest confidentiality）。这是 BOL 数据存在系统性盲区的根本原因。

## 实务影响

- 即使我们能拿到完整公开 BOL 数据集，依然有大量"匿名"或"被替换"的字段
- 部分跨国公司常态化申请保密
- 重要的 strategically-sensitive shipment 通常不会出现在公开数据
- 货代 / freight forwarder 的名字常常出现在 BOL 上代替真实买家

## 系统层对策

### 1. 在 evidence 中显式标注

任何来自 BOL 的 evidence 必须在 `metadata.warning` 中包含：

```
- BOL 字段可能为货代、贸易商或被授予保密的实体
- 公开 BOL 数据存在系统性盲区（CBP manifest confidentiality）
- HS code 不能唯一标识具体产品
```

### 2. 抽取规则不"自信化"

BOL 推断关系：

- evidence_level 上限 3
- is_inferred = true
- needs_review = true
- confidence 受 freight_forwarder 风险因子影响

### 3. unknown_map 显式提及

任何依赖海关 / 物流的研究，unknown_map 必须包含：

```yaml
- question: "Which shipments are missing from public BOL due to manifest confidentiality?"
  why_unknown: "CBP allows importers/consignees/shippers to request confidentiality; we cannot enumerate the missing set."
  status: open
```

### 4. 不做"BOL 比对推断的份额"等过度精确

例：不能说"X 占 Y 货量的 30%"。因为我们看到的可能不是全部。

## 法律与合规

- 我们不绕过 CBP 保密申请
- 我们不通过非法渠道获取被保密的数据
- 不假装 BOL 数据是完整的
- 不通过聚合平台来"推断已被保密的实体"

## 数据消费者教育

任何展示 BOL 推断结果的输出（CompanyCard、ComponentCard、ResearchReport）必须含 disclaimer：

```
This page may include inferences from public Bill of Lading data.
Public BOL data is incomplete due to CBP manifest confidentiality
and may contain freight forwarders or trading companies in place of
the actual buyer/seller. Use these inferences with caution.
```

CLI 渲染时自动附此段（除非 `--no-disclaimer`）。

## 参考

- CBP "Electronic Vessel Manifest Confidentiality" 政策页面
- 各家货代 / 海关数据聚合平台的方法论说明
