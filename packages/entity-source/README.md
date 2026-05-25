# @supplystrata/entity-source

`entity-source` 定义外部实体登记源候选的标准形状。

## 负责什么

- 定义 GLEIF、OpenCorporates、Companies House 等实体来源候选 DTO。
- 归一化候选名称和 alias。
- 提供候选 alias 列表。

## 不负责什么

- 不访问外部 API。
- 不写实体主数据。
- 不做最终实体消歧。
- 不自动把外部候选变成 active entity。

## 主要入口

- `createEntitySourceCandidate(input)`：创建标准候选。
- `candidateAliases(candidate)`：生成候选 alias 列表。

## 边界约定

entity-source candidate 是 review 输入，不是实体主数据。写入必须走 entity-import 的受控路径。
