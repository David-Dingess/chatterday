' Starts the Chatterday server with no window: it sits as an icon by the clock.
' Right-click that icon to see the log, restart, or stop the server.
Set shell = CreateObject("WScript.Shell")
here = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\scripts\server-tray.ps1""", 0, False
