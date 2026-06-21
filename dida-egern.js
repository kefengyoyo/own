#!name=dida
#!desc=dida

[Script]
dida = type=http-response, pattern=^https:\/\/dida365\.com\/api\/v2\/user\/status, script-path=https://raw.githubusercontent.com/afengye/QX/main/dida.js, requires-body=true, max-size=-1, timeout=60

[MITM]
hostname = %APPEND% dida365.com
