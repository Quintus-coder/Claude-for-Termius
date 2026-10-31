# Claude for Termius · Windows 本地主题补丁

**完全退出 Termius，解压整个文件夹，然后双击 `Install-Claude.cmd`。**

重新打开 Termius，在终端主题列表中选择 **Claude Light** 或 **Claude Dark**。运行服务器上的 Claude Code 后，用 `/theme` 选择对应的 Light 或 Dark。

## 修改内容与限制

这是非官方的本地安装文件补丁，不是官方主题导入格式。它把内置的 Flexoki Light / Dark 两项预设替换为 Claude 配色，并修改 `app.asar` 及 `Termius.exe` 中对应的完整性校验记录。其他主题保持原样。

修改 EXE 后，原始数字签名将不再匹配。Electron 的安全开关保持原样，ASAR 完整性校验会同步更新。若你的电脑要求所有应用保持发行商签名，请不要应用这个补丁。

适配检查基于官方 **Termius 10.2.1 Windows x64** 安装包：四个主题模块、嵌入的完整性记录、重复安装以及恢复均已在这些真实文件副本上验证。**没有运行 Windows 图形界面实测。** 结构不匹配或检测到未知修改时，工具会停止。

## 恢复

完全退出 Termius，双击 `Restore-Original.cmd`。恢复工具会核对备份和当前文件的哈希，再还原原始文件；在已验证的样本中，还原结果与原版逐字节一致。

安装前的文件保存在 Termius 安装目录下的 `claude-theme-backup`，约占 400 MB。不要删除该目录，否则无法通过本工具还原。安装过程中遇到写入失败会尝试恢复；如进程被强制终止，可重新运行恢复入口。

Termius 更新后可能覆盖主题。重新安装补丁前可运行 `Check-Compatibility.cmd`。恢复工具不会用旧版备份覆盖更新后的安装文件。

## 使用条件

Windows 桌面安装版。常见安装目录会自动识别；找不到时会打开文件选择框，请选择正在使用的 `Termius.exe`。如果提示拒绝访问，可右键入口选择“以管理员身份运行”。

不要求安装 Python 或 Node.js。已有 Node.js 16+ 时使用它；否则临时复制 Termius 自带的运行环境来执行工具，执行结束后清理临时目录。临时运行环境约需 300 MB 可用空间，安装备份另需约 400 MB。

脚本只操作本地安装文件和本工具的备份，不联网，也不读取主机列表、密钥、密码或云端账户数据。不需要在服务器安装任何工具。

## 配色

浅色：暖白背景 `#faf9f5`，墨色文字 `#141413`，陶土橙光标 `#d97757`。

深色：炭灰背景 `#262624`，米白文字 `#faf9f5`，陶土橙光标 `#d97757`。

## 参考资料

官方安装包：https://termius.com/download/windows

Anthropic 品牌色：https://github.com/anthropics/skills/blob/main/skills/brand-guidelines/SKILL.md

Electron ASAR 完整性机制：https://www.electronjs.org/docs/latest/tutorial/asar-integrity
