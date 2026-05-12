# MCRULES

## SSH FS - N2-Docker (IMPORTANT)

Part of this workspace (/SSH FS - N2-Docker.lan) is mounted using:
https://open-vsx.org/extension/Kelvin/vscode-sshfs

### 🔒 Key Rule
"SSH FS - N2-Docker" is a **remote file system only**.

Cursor must NEVER:
- Run commands on this machine
- Assume terminal or shell access exists
- Execute scripts remotely
- Start services, containers, or builds

### 📁 Allowed Actions
Only:
- Read files
- Edit files
- Create/delete/rename files locally in the editor
- Suggest commands (but do not run them)

### 🧠 Behavior Rule
If a command is needed:
- Show it to the user
- Clearly state it must be run manually on the target system

### ⚠️ Default Assumption
Treat SSH FS mounts as:
> "Just a folder on a remote machine"

No execution capability is available.