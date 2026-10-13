# 导入的 ErrGrind 会话数据

[English](README.md) | 中文

`data/` 保存从旧版 Python 产品迁移过来的历史错题记录，让这批数据随仓库
流转而不是绑在一台机器上。

- `data/sessions/<id>/` —— 每条会话一份 `session.v4.jsonl.zstd` 日志
  （8 条导入 Error、2 条练习会话、1 条已归档 Error）。
- `data/attachments/v1/` —— 日志引用的附件 blob，按运行时的三视图
  内容寻址结构原样保存。
- `data/workspace-state.json` —— 会话 id 清单及归档标记。
- `restore.py` —— 把数据拷进 `~/.errgrind` 并登记到指定项目路径
  对应的工作区。
- `import.py` —— 生成这批日志的导入器，保留作溯源用；它的输入库
  （`errgrind-vps.db`）不在仓库里。

## 恢复

先在项目目录里把应用启动一次，让 `~/.errgrind` 和 workspace 存储就位，
然后：

```sh
python3 errgrind-fork/import/restore.py --cwd /path/to/ErrGrind
```

脚本按 `session-persistence-jsonl` 的 `projectKey` 规则从 `--cwd`
推导会话目录 key，所以无论目标机器用什么路径日志都能落对位置。重复
执行幂等：会话 id 与归档标记合并进 `sessionIds` 和
`archivedSessionIds`，不产生重复。
