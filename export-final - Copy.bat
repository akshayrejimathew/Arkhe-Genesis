@echo off
echo Creating project export...
echo PROJECT EXPORT > project_export.txt
echo Date: %date% %time% >> project_export.txt
echo. >> project_export.txt

for /r . %%f in (*.jsx *.js *.css *.html *.json *.ts *.tsx *.txt *.md *.env* *.sql) do (
    echo Processing: %%f
    echo FILE: %%f >> project_export.txt
    echo CONTENT: >> project_export.txt
    echo --------------------------------- >> project_export.txt
    type "%%f" >> project_export.txt
    echo --------------------------------- >> project_export.txt
    echo. >> project_export.txt
    echo ================================= >> project_export.txt
    echo. >> project_export.txt
)

echo.
echo Export complete! Check project_export.txt
pause