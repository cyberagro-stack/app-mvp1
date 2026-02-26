"C:\Program Files\Git\cmd\git.exe" --no-pager init
"C:\Program Files\Git\cmd\git.exe" --no-pager config user.email "cyberagro.contato@gmail.com"
"C:\Program Files\Git\cmd\git.exe" --no-pager config user.name "CyberAgro"
"C:\Program Files\Git\cmd\git.exe" --no-pager config core.autocrlf false
"C:\Program Files\Git\cmd\git.exe" --no-pager remote add origin https://github.com/cyberagro-stack/app-mvp1.git
"C:\Program Files\Git\cmd\git.exe" --no-pager add .
"C:\Program Files\Git\cmd\git.exe" --no-pager commit -m "Deploy final CyberAgro v1.0"
echo "Done"
