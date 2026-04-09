Set shell = CreateObject("WScript.Shell")
scriptPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = """" & powershellPath & """ -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & "\start-server-background.ps1"""
shell.Run command, 0, False
