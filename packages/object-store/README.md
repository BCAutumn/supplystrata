# @supplystrata/object-store

`object-store` 是二进制对象存储的最小端口和本地文件系统实现。

## 负责什么

- 定义 `ObjectStore` 接口。
- 提供 `FsObjectStore` 本地实现。
- 安全写入、读取、检查和返回对象路径。

## 不负责什么

- 不解析文档。
- 不计算 source authority。
- 不保存数据库 metadata。
- 不实现云对象存储。

## 主要入口

- `ObjectStore`：对象存储端口。
- `FsObjectStore(baseDir)`：本地文件系统实现。

## 边界约定

object store 只保存原始或派生二进制对象。数据库中的 document metadata 仍由 source adapter / db 写入链路维护。
