$env:JAVA_HOME = 'C:\Users\polyc\AppData\Local\Programs\TemurinJDK21'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
java -version
Set-Location 'C:\Community_reporting\android-app'
npm.cmd run build:apk
