@echo off
chcp 65001 >nul 2>&1
setlocal EnableExtensions EnableDelayedExpansion
title Twinslop: установка инструментов для реверса APK

rem ============================================================================
rem  install-re-tools.bat — ставит набор для реверса APK в Windows.
rem
rem  Использование (можно двойным кликом — тогда базовый набор):
rem    install-re-tools.bat              базовый набор
rem    install-re-tools.bat --full       + Ghidra
rem    install-re-tools.bat --check      только показать, что уже стоит
rem    install-re-tools.bat --dry-run    показать план, ничего не менять
rem    install-re-tools.bat --dir D:\re  куда ставить (по умолчанию %USERPROFILE%\re-tools)
rem
rem  Требуется Windows 10/11. Используются winget (если есть), curl.exe и
rem  PowerShell (оба входят в Windows) — ничего доустанавливать не нужно.
rem
rem  Инструменты — для СВОИХ приложений и стендов. Обход защиты чужого ПО
rem  нарушает закон и правила магазинов.
rem ============================================================================

set "TOOLS_DIR=%USERPROFILE%\re-tools"
set "BIN_DIR=%TOOLS_DIR%\bin"
set "MODE=core"
set "CHECK_ONLY=0"
set "DRY_RUN=0"
set "WITH_DEVICE=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--full"        ( set "MODE=full" & shift & goto parse_args )
if /i "%~1"=="--check"       ( set "CHECK_ONLY=1" & shift & goto parse_args )
if /i "%~1"=="--dry-run"     ( set "DRY_RUN=1" & shift & goto parse_args )
if /i "%~1"=="--with-device" ( set "WITH_DEVICE=1" & shift & goto parse_args )
if /i "%~1"=="--dir" (
    set "TOOLS_DIR=%~2"
    set "BIN_DIR=%~2\bin"
    shift & shift & goto parse_args
)
if /i "%~1"=="-h"     goto usage
if /i "%~1"=="--help" goto usage
echo Неизвестный аргумент: %~1
goto usage

:args_done
if not defined TOOLS_DIR set "TOOLS_DIR=%USERPROFILE%\re-tools"
set "BIN_DIR=%TOOLS_DIR%\bin"

echo.
echo  Twinslop: установка инструментов для реверса APK
echo  Каталог: %TOOLS_DIR%
echo  Режим:   %MODE%
if "%DRY_RUN%"=="1" echo  Режим:   dry-run (ничего не меняю)
echo.

if "%CHECK_ONLY%"=="1" (
    call :verify
    goto done
)

call :install_system
call :ensure_dirs
call :install_jadx
call :install_apktool
call :install_android_sdk
call :install_python_tools
call :install_dex2jar
call :install_il2cpp
if /i "%MODE%"=="full" call :install_ghidra
if "%WITH_DEVICE%"=="1" call :install_frida_server
call :setup_path

if "%DRY_RUN%"=="1" (
    echo.
    echo  [dry-run] Ничего не изменено. Запусти без --dry-run, чтобы установить.
) else (
    call :verify
)

echo.
echo  Дальше:
echo    1^) открой НОВОЕ окно терминала ^(PATH обновится только там^)
echo    2^) триаж APK:   bash scripts/apk-triage.sh app.apk      ^(Git Bash / WSL^)
echo    3^) инструкция:  docs\PROSTO.html  и  docs\REVERSE-APK.html
echo    4^) телефон:     adb devices
echo.
echo  Напоминание: инструменты — для своих приложений и образцов с разрешения.
echo.
goto done

rem ============================================================================
rem  вспомогательные
rem ============================================================================

:ok
echo   [ok] %~1
exit /b 0

:warn
echo   [warn] %~1
exit /b 0

:err
echo   [x]  %~1
exit /b 0

:step
echo.
echo == %~1 ==
exit /b 0

:have
rem %1 — имя программы в PATH
where "%~1" >nul 2>&1
exit /b %errorlevel%

:ensure_dirs
if "%DRY_RUN%"=="1" (
    echo   [dry] mkdir "%TOOLS_DIR%"
    echo   [dry] mkdir "%BIN_DIR%"
    exit /b 0
)
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
exit /b 0

rem gh_latest_url <repo> <needle1> <needle2> <outVar>
:gh_latest_url
call :step "ищу последний релиз %~1"
set "JSON=%TEMP%\twinslop-rel.json"
if "%DRY_RUN%"=="1" (
    echo   [dry] curl https://api.github.com/repos/%~1/releases/latest
    exit /b 0
)
del /q "%JSON%" >nul 2>&1
curl -fsSL -H "User-Agent: twinslop-installer" "https://api.github.com/repos/%~1/releases/latest" -o "%JSON%" >nul 2>&1
if errorlevel 1 (
    call :warn "GitHub API недоступен для %~1"
    set "%~4="
    exit /b 0
)
set "URL="
for /f "usebackq delims=" %%L in (`findstr /c:"browser_download_url" "%JSON%"`) do (
    if not defined URL (
        set "LINE=%%L"
        set "LINE=!LINE:*https=https!"
        set "LINE=!LINE:~0,-2!"
        if not "!LINE:%~2=!"=="!LINE!" if not "!LINE:%~3=!"=="!LINE!" (
            set "SKIP="
            if not "%~5"=="" if not "!LINE:%~5=!"=="!LINE!" set "SKIP=1"
            if not defined SKIP set "URL=!LINE!"
        )
    )
)
set "%~4=%URL%"
exit /b 0

rem download <url> <dest>
:download
if "%DRY_RUN%"=="1" (
    echo   [dry] скачать %~1
    exit /b 0
)
curl -fL --retry 2 -o "%~2" "%~1" 2>nul
if errorlevel 1 (
    call :err "скачать не удалось: %~1"
    exit /b 1
)
exit /b 0

rem unzip <zip> <dest>
:unzip
if "%DRY_RUN%"=="1" (
    echo   [dry] распаковать %~1
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%~1' -DestinationPath '%~2' -Force" >nul 2>&1
if errorlevel 1 (
    call :err "распаковать не удалось: %~1"
    exit /b 1
)
exit /b 0

rem winget_install <id> <что это>
:winget_install
call :have winget
if errorlevel 1 (
    call :warn "winget нет — поставь %~2 вручную"
    exit /b 0
)
if "%DRY_RUN%"=="1" (
    echo   [dry] winget install %~1
    exit /b 0
)
winget install --id %~1 --silent --accept-package-agreements --accept-source-agreements >nul 2>&1
if errorlevel 1 (
    call :warn "winget не поставил %~1 (возможно, уже стоит)"
) else (
    call :ok "%~2"
)
exit /b 0

rem ============================================================================
rem  системные зависимости
rem ============================================================================

:install_system
call :step "системные зависимости"
call :winget_install EclipseAdoptium.Temurin.17.JDK "Java 17 (нужна apktool, Ghidra, SDK)"
call :winget_install Python.Python.3.12 "Python 3.12 (androguard, frida)"
call :winget_install Microsoft.DotNet.Runtime.8 ".NET 8 runtime (Il2CppDumper)"
call :have curl
if errorlevel 1 (
    call :warn "curl.exe не найден: нужен Windows 10 1803+ или установить curl вручную"
) else (
    call :ok "curl.exe есть"
)
exit /b 0

rem ============================================================================
rem  jadx
rem ============================================================================

:install_jadx
call :step "jadx (dex -> Java)"
call :have jadx
if not errorlevel 1 (
    call :ok "jadx уже в PATH"
    exit /b 0
)
call :gh_latest_url skylot/jadx "jadx-" ".zip" JADX_URL "gui"
if not defined JADX_URL (
    call :warn "не нашёл релиз jadx"
    exit /b 0
)
call :download "%JADX_URL%" "%TOOLS_DIR%\jadx.zip"
if errorlevel 1 exit /b 0
if exist "%TOOLS_DIR%\jadx" rmdir /s /q "%TOOLS_DIR%\jadx"
call :unzip "%TOOLS_DIR%\jadx.zip" "%TOOLS_DIR%\jadx"
if not "%DRY_RUN%"=="1" del /q "%TOOLS_DIR%\jadx.zip" >nul 2>&1
call :ok "jadx -> %TOOLS_DIR%\jadx\bin"
exit /b 0

rem ============================================================================
rem  apktool
rem ============================================================================

:install_apktool
call :step "apktool (ресурсы и smali)"
call :have apktool
if not errorlevel 1 (
    call :ok "apktool уже в PATH"
    exit /b 0
)
call :gh_latest_url iBotPeaches/Apktool "apktool_" ".jar" APKTOOL_URL
if not defined APKTOOL_URL (
    call :warn "не нашёл релиз apktool"
    exit /b 0
)
if not "%DRY_RUN%"=="1" if not exist "%TOOLS_DIR%\apktool" mkdir "%TOOLS_DIR%\apktool"
call :download "%APKTOOL_URL%" "%TOOLS_DIR%\apktool\apktool.jar"
if errorlevel 1 exit /b 0
if "%DRY_RUN%"=="1" (
    echo   [dry] создать %BIN_DIR%\apktool.bat
    exit /b 0
)
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
> "%BIN_DIR%\apktool.bat" echo @echo off
>> "%BIN_DIR%\apktool.bat" echo java -Xmx1024m -jar "%TOOLS_DIR%\apktool\apktool.jar" %%*
call :ok "apktool -> %BIN_DIR%\apktool.bat"
exit /b 0

rem ============================================================================
rem  Android SDK: aapt2, apksigner, adb
rem ============================================================================

:install_android_sdk
call :step "Android SDK (aapt2, apksigner, adb)"
set "SDK=%TOOLS_DIR%\android-sdk"
if exist "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" (
    call :ok "cmdline-tools уже распакованы"
    goto sdk_packages
)
call :download "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip" "%TEMP%\cmdline-tools.zip"
if errorlevel 1 exit /b 0
if "%DRY_RUN%"=="1" exit /b 0
if not exist "%SDK%\cmdline-tools" mkdir "%SDK%\cmdline-tools"
call :unzip "%TEMP%\cmdline-tools.zip" "%SDK%\cmdline-tools"
del /q "%TEMP%\cmdline-tools.zip" >nul 2>&1
if exist "%SDK%\cmdline-tools\cmdline-tools" move "%SDK%\cmdline-tools\cmdline-tools" "%SDK%\cmdline-tools\latest" >nul 2>&1

:sdk_packages
if "%DRY_RUN%"=="1" (
    echo   [dry] sdkmanager --install platform-tools build-tools;34.0.0
    exit /b 0
)
if not exist "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" (
    call :warn "sdkmanager не распаковался — Android SDK пропущен"
    exit /b 0
)
set "ANDROID_HOME=%SDK%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Environment]::SetEnvironmentVariable('ANDROID_HOME','%SDK%','User')" >nul 2>&1
echo y| "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" --licenses >nul 2>&1
call "%SDK%\cmdline-tools\latest\bin\sdkmanager.bat" --install "platform-tools" "build-tools;34.0.0" >nul 2>&1
if errorlevel 1 (
    call :warn "sdkmanager не поставил пакеты (нет сети?)"
) else (
    call :ok "platform-tools + build-tools 34.0.0"
)
exit /b 0

rem ============================================================================
rem  Python-инструменты
rem ============================================================================

:install_python_tools
call :step "Python: androguard, apkid, frida-tools"
call :have python
if errorlevel 1 (
    call :warn "Python не найден — пропускаю (перезапусти после установки Python)"
    exit /b 0
)
if "%DRY_RUN%"=="1" (
    echo   [dry] pip install androguard pyaxmlparser apkid
    echo   [dry] python -m venv %TOOLS_DIR%\frida-venv
    echo   [dry] pip install frida-tools objection
    exit /b 0
)
python -m pip install --quiet --upgrade pip >nul 2>&1
python -m pip install --quiet androguard pyaxmlparser apkid >nul 2>&1
if errorlevel 1 (
    call :warn "pip не поставил androguard/apkid"
) else (
    call :ok "androguard, pyaxmlparser, apkid"
)
set "FRIDA_VENV=%TOOLS_DIR%\frida-venv"
if not exist "%FRIDA_VENV%\Scripts\frida.exe" (
    python -m venv "%FRIDA_VENV%" >nul 2>&1
    "%FRIDA_VENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip >nul 2>&1
    "%FRIDA_VENV%\Scripts\python.exe" -m pip install --quiet frida-tools objection >nul 2>&1
)
if exist "%FRIDA_VENV%\Scripts\frida.exe" (
    call :ok "frida-tools + objection -> %FRIDA_VENV%\Scripts"
) else (
    call :warn "frida-tools не установились"
)
exit /b 0

rem ============================================================================
rem  dex2jar
rem ============================================================================

:install_dex2jar
call :step "dex2jar (dex -> jar)"
call :have d2j-dex2jar
if not errorlevel 1 (
    call :ok "dex2jar уже в PATH"
    exit /b 0
)
call :gh_latest_url pxb1988/dex2jar "dex-tools" ".zip" D2J_URL
if not defined D2J_URL (
    call :warn "не нашёл релиз dex2jar"
    exit /b 0
)
call :download "%D2J_URL%" "%TOOLS_DIR%\dex2jar.zip"
if errorlevel 1 exit /b 0
if exist "%TOOLS_DIR%\dex2jar" rmdir /s /q "%TOOLS_DIR%\dex2jar"
call :unzip "%TOOLS_DIR%\dex2jar.zip" "%TOOLS_DIR%\dex2jar"
if not "%DRY_RUN%"=="1" del /q "%TOOLS_DIR%\dex2jar.zip" >nul 2>&1
call :ok "dex2jar -> %TOOLS_DIR%\dex2jar"
exit /b 0

rem ============================================================================
rem  Il2CppDumper
rem ============================================================================

:install_il2cpp
call :step "Il2CppDumper (Unity IL2CPP)"
if exist "%TOOLS_DIR%\Il2CppDumper\Il2CppDumper.exe" (
    call :ok "Il2CppDumper уже распакован"
    exit /b 0
)
call :gh_latest_url Perfare/Il2CppDumper "Il2CppDumper-win" ".zip" I2C_URL
if not defined I2C_URL call :gh_latest_url Perfare/Il2CppDumper "Il2CppDumper" ".zip" I2C_URL
if not defined I2C_URL (
    call :warn "не нашёл релиз Il2CppDumper"
    exit /b 0
)
call :download "%I2C_URL%" "%TOOLS_DIR%\il2cppdumper.zip"
if errorlevel 1 exit /b 0
if not "%DRY_RUN%"=="1" if not exist "%TOOLS_DIR%\Il2CppDumper" mkdir "%TOOLS_DIR%\Il2CppDumper"
call :unzip "%TOOLS_DIR%\il2cppdumper.zip" "%TOOLS_DIR%\Il2CppDumper"
if not "%DRY_RUN%"=="1" del /q "%TOOLS_DIR%\il2cppdumper.zip" >nul 2>&1
call :ok "Il2CppDumper -> %TOOLS_DIR%\Il2CppDumper"
exit /b 0

rem ============================================================================
rem  Ghidra (--full)
rem ============================================================================

:install_ghidra
call :step "Ghidra (нативный код -> псевдо-C)"
if exist "%TOOLS_DIR%\ghidra\ghidraRun.bat" (
    call :ok "Ghidra уже распакована"
    exit /b 0
)
call :gh_latest_url NationalSecurityAgency/ghidra "_PUBLIC_" ".zip" GHIDRA_URL
if not defined GHIDRA_URL (
    call :warn "не нашёл релиз Ghidra"
    exit /b 0
)
call :warn "Ghidra весит около 450 МБ — качается долго"
call :download "%GHIDRA_URL%" "%TOOLS_DIR%\ghidra.zip"
if errorlevel 1 exit /b 0
call :unzip "%TOOLS_DIR%\ghidra.zip" "%TOOLS_DIR%\ghidra-tmp"
if "%DRY_RUN%"=="1" exit /b 0
del /q "%TOOLS_DIR%\ghidra.zip" >nul 2>&1
for /d %%D in ("%TOOLS_DIR%\ghidra-tmp\ghidra_*") do move "%%D" "%TOOLS_DIR%\ghidra" >nul 2>&1
rmdir /s /q "%TOOLS_DIR%\ghidra-tmp" >nul 2>&1
if exist "%TOOLS_DIR%\ghidra\ghidraRun.bat" (
    call :ok "Ghidra -> %TOOLS_DIR%\ghidra"
) else (
    call :warn "Ghidra распаковалась не туда — проверь %TOOLS_DIR%"
)
exit /b 0

rem ============================================================================
rem  frida-server на устройство (--with-device)
rem ============================================================================

:install_frida_server
call :step "frida-server на телефон"
call :have adb
if errorlevel 1 (
    call :warn "adb нет — пропускаю"
    exit /b 0
)
for /f "tokens=*" %%S in ('adb devices 2^>nul ^| findstr /r /c:"device$"') do set "SERIAL=%%S"
if not defined SERIAL (
    call :warn "телефон не подключён (adb devices) — пропускаю"
    exit /b 0
)
echo   Телефон: !SERIAL!
echo   Подключи телефон с включённой отладкой и root, затем:
echo     adb shell "su -c '/data/local/tmp/frida-server &'"
echo     frida-ps -U
exit /b 0

rem ============================================================================
rem  PATH
rem ============================================================================

:setup_path
call :step "PATH"
set "PATHS=%BIN_DIR%"
if exist "%TOOLS_DIR%\jadx\bin" set "PATHS=%PATHS%;%TOOLS_DIR%\jadx\bin"
if exist "%TOOLS_DIR%\android-sdk\platform-tools" set "PATHS=%PATHS%;%TOOLS_DIR%\android-sdk\platform-tools"
if exist "%TOOLS_DIR%\android-sdk\build-tools\34.0.0" set "PATHS=%PATHS%;%TOOLS_DIR%\android-sdk\build-tools\34.0.0"
if exist "%TOOLS_DIR%\android-sdk\cmdline-tools\latest\bin" set "PATHS=%PATHS%;%TOOLS_DIR%\android-sdk\cmdline-tools\latest\bin"
if exist "%TOOLS_DIR%\frida-venv\Scripts" set "PATHS=%PATHS%;%TOOLS_DIR%\frida-venv\Scripts"
if exist "%TOOLS_DIR%\dex2jar" set "PATHS=%PATHS%;%TOOLS_DIR%\dex2jar"

if "%DRY_RUN%"=="1" (
    echo   [dry] добавить в PATH пользователя: %PATHS%
    exit /b 0
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dirs='%PATHS%' -split ';'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; $add=@(); foreach($d in $dirs){ if($d -and ($p -notlike ('*'+$d+'*'))){ $add += $d } }; if($add.Count -gt 0){ $new = if($p){ $p + ';' + ($add -join ';') } else { $add -join ';' }; [Environment]::SetEnvironmentVariable('Path',$new,'User'); Write-Host ('   [ok] добавлено: ' + ($add -join '; ')) } else { Write-Host '   [ok] PATH уже настроен' }"
exit /b 0

rem ============================================================================
rem  проверка
rem ============================================================================

:verify
call :step "проверка установленного"
set "MISSING="
for %%T in (jadx apktool aapt2 apksigner adb d2j-dex2jar frida dotnet python) do (
    where %%T >nul 2>&1
    if errorlevel 1 (
        echo    %%T   нет
        set "MISSING=!MISSING! %%T"
    ) else (
        for /f "delims=" %%P in ('where %%T 2^>nul') do (
            if not defined SHOWN_%%T (
                echo    %%T  -^>  %%P
                set "SHOWN_%%T=1"
            )
        )
    )
)
if "%MODE%"=="full" (
    if exist "%TOOLS_DIR%\ghidra\ghidraRun.bat" (
        echo    ghidra  -^>  %TOOLS_DIR%\ghidra\ghidraRun.bat
    ) else (
        echo    ghidra   нет
    )
)
if defined MISSING (
    echo.
    echo    Не установлено:!MISSING!
    echo    Открой НОВОЕ окно терминала и запусти проверку снова:
    echo      install-re-tools.bat --check
) else (
    echo.
    echo    Всё на месте.
)
exit /b 0

:usage
echo.
echo  install-re-tools.bat — установка инструментов для реверса APK
echo.
echo    install-re-tools.bat              базовый набор
echo    install-re-tools.bat --full       + Ghidra (около 450 МБ)
echo    install-re-tools.bat --check      показать, что уже стоит
echo    install-re-tools.bat --dry-run    показать план, ничего не менять
echo    install-re-tools.bat --dir D:\re  каталог установки
echo    install-re-tools.bat --with-device  подсказки по frida-server
echo.
goto done

:done
echo.
pause
endlocal
exit /b 0
