@echo off
rem  Кодировка файла: Windows-1251 (CP1251). Не пересохраняй в UTF-8:
rem  cmd.exe сбивается на UTF-8 в .bat и начинает выполнять обрывки строк.
chcp 1251 >nul 2>&1
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

:reload_path
rem перечитывает PATH из реестра: winget ставит Java/Python уже ПОСЛЕ старта окна
if "%DRY_RUN%"=="1" exit /b 0
set "NEWPATH="
for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"`) do set "NEWPATH=%%P"
if defined NEWPATH set "PATH=%NEWPATH%"
exit /b 0

:ensure_dirs
powershell -NoProfile -Command "if ('%TOOLS_DIR%' -match '[^\x20-\x7E]') { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 call :warn "в пути к инструментам есть кириллица: часть утилит может капризничать, при сбоях переставь с --dir C:\re"
if "%DRY_RUN%"=="1" (
    echo   [dry] mkdir "%TOOLS_DIR%"
    echo   [dry] mkdir "%BIN_DIR%"
    exit /b 0
)
if not exist "%TOOLS_DIR%" mkdir "%TOOLS_DIR%"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
exit /b 0

rem gh_latest_url <owner/repo> <needle1> <needle2> <outVar> [exclude]
:gh_latest_url
call :step "ищу последний релиз %~1"
set "%~4="
if "%DRY_RUN%"=="1" (
    echo   [dry] GitHub API: %~1
    exit /b 0
)
set "EXC=%~5"
if not defined EXC set "EXC=~none~"
set "TMPURL=%TEMP%\twinslop-url.txt"
del /q "%TMPURL%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $h=@{'User-Agent'='Twinslop'}; $a=@(); try { $a=@((Invoke-RestMethod -Headers $h -Uri 'https://api.github.com/repos/%~1/releases/latest').assets.browser_download_url) } catch { }; $m=@($a).Where({ $_ -like '*%~2*' -and $_ -like '*%~3*' -and $_ -notlike '*%EXC%*' }); if ($m.Count -gt 0) { [IO.File]::WriteAllText('%TMPURL%', [string]$m[0]) }" >nul 2>&1
set "URL="
if exist "%TMPURL%" set /p URL=<"%TMPURL%"
del /q "%TMPURL%" >nul 2>&1
if defined URL (
    echo         нашёл: !URL!
    set "%~4=!URL!"
) else (
    call :warn "GitHub не дал файл для %~1 — беру проверенную версию"
)
exit /b 0

rem download <url> <dest>
:download
set "SRC=%~1"
set "DST=%~2"
if /i "%DST:~0,4%"=="http" (
    set "SRC=%~2"
    set "DST=%~1"
)
if /i not "%SRC:~0,4%"=="http" (
    call :err "битая ссылка на файл: %SRC%"
    exit /b 1
)
if "%DRY_RUN%"=="1" (
    echo   [dry] скачать %SRC%
    exit /b 0
)
echo         качаю: %DST%
curl -fL --retry 2 --progress-bar -o "%DST%" "%SRC%"
if errorlevel 1 (
    call :err "скачать не удалось: %SRC%"
    exit /b 1
)
exit /b 0

rem unzip <zip> <dest>
:unzip
if "%DRY_RUN%"=="1" (
    echo   [dry] распаковать %~1
    exit /b 0
)
echo         распаковываю %~nx1 ...
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
echo   [..]  %~2
echo         winget качает и ставит: 1-3 минуты. Экран может «стоять» - это нормально.
echo         Если выскочило окно контроля учётных записей (UAC) - нажми «Да».
winget install --id %~1 --silent --accept-package-agreements --accept-source-agreements %~3
if errorlevel 1 (
    call :warn "winget не поставил %~1 (уже стоит или нет прав администратора)"
) else (
    call :ok "%~2"
)
exit /b 0

rem ============================================================================
rem  системные зависимости
rem ============================================================================

:install_system
call :step "системные зависимости"
call :reload_path
for %%T in (java python dotnet) do (
    where %%T >nul 2>&1 && echo   [ok] %%T уже стоит
)
net session >nul 2>&1
if errorlevel 1 echo   [i] Права администратора: нет. Java и .NET могут спросить UAC.
call :have java
if errorlevel 1 call :winget_install EclipseAdoptium.Temurin.17.JDK "Java 17 (нужна apktool, Ghidra, Android SDK)"
call :have python
if errorlevel 1 call :winget_install Python.Python.3.12 "Python 3.12 (androguard, frida)" "--scope user"
call :have dotnet
if errorlevel 1 call :winget_install Microsoft.DotNet.Runtime.8 ".NET 8 runtime (Il2CppDumper)"
call :have curl
if errorlevel 1 (
    call :warn "curl.exe не найден: нужен Windows 10 1803+ или установить curl вручную"
) else (
    call :ok "curl.exe есть"
)
call :reload_path
echo.
echo   Дальше пойдут загрузки с GitHub: jadx, apktool, Android SDK, dex2jar.
echo   У каждого будет строка «качаю ...» и полоса прогресса.
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
if not defined JADX_URL set "JADX_URL=https://github.com/skylot/jadx/releases/download/v1.5.7/jadx-1.5.7.zip"
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
if not exist "%TOOLS_DIR%\apktool\apktool.jar" (
    call :gh_latest_url iBotPeaches/Apktool "apktool_" ".jar" APKTOOL_URL
    if not defined APKTOOL_URL set "APKTOOL_URL=https://github.com/iBotPeaches/Apktool/releases/download/v3.0.3/apktool_3.0.3.jar"
    if not "%DRY_RUN%"=="1" if not exist "%TOOLS_DIR%\apktool" mkdir "%TOOLS_DIR%\apktool"
    call :download "%APKTOOL_URL%" "%TOOLS_DIR%\apktool\apktool.jar"
    if errorlevel 1 exit /b 0
) else (
    call :ok "apktool.jar уже скачан"
)
if "%DRY_RUN%"=="1" (
    echo   [dry] создать %BIN_DIR%\apktool.bat
    exit /b 0
)
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
rem  обёртка без единого русского символа: путь берётся из %%~dp0 при запуске.
rem  Иначе кириллица из %USERPROFILE% пишется в кодировке консоли и ломает путь.
> "%BIN_DIR%\apktool.bat" echo @echo off
>> "%BIN_DIR%\apktool.bat" echo java -Xmx1024m -jar "%%~dp0..\apktool\apktool.jar" %%*
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
set "PYEXE="
call :have python
if not errorlevel 1 set "PYEXE=python"
if not defined PYEXE (
    call :have py
    if not errorlevel 1 set "PYEXE=py -3"
)
if not defined PYEXE (
    call :warn "Python не найден — поставь Python 3 и запусти установщик снова"
    exit /b 0
)
if "%DRY_RUN%"=="1" (
    echo   [dry] pip install androguard pyaxmlparser apkid
    echo   [dry] python -m venv %TOOLS_DIR%\frida-venv
    echo   [dry] pip install frida-tools objection
    exit /b 0
)
%PYEXE% -m pip install --quiet --upgrade pip >nul 2>&1
%PYEXE% -m pip install --quiet androguard pyaxmlparser apkid >nul 2>&1
if errorlevel 1 (
    call :warn "pip не поставил androguard/apkid"
) else (
    call :ok "androguard, pyaxmlparser, apkid"
)
set "FRIDA_VENV=%TOOLS_DIR%\frida-venv"
if not exist "%FRIDA_VENV%\Scripts\frida.exe" (
    %PYEXE% -m venv "%FRIDA_VENV%" >nul 2>&1
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
if not defined D2J_URL set "D2J_URL=https://github.com/pxb1988/dex2jar/releases/download/v2.4/dex-tools-v2.4.zip"
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
if not defined I2C_URL set "I2C_URL=https://github.com/Perfare/Il2CppDumper/releases/download/v6.7.46/Il2CppDumper-win-v6.7.46.zip"
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
if not defined GHIDRA_URL set "GHIDRA_URL=https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.2_build/ghidra_12.2_PUBLIC_20261016.zip"
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
