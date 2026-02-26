@echo off
setlocal
echo Adding Windows Firewall rule for TCP port 8080...
netsh advfirewall firewall add rule name="Symptomatologist Copilot" dir=in action=allow protocol=TCP localport=8080
echo Done.
pause
