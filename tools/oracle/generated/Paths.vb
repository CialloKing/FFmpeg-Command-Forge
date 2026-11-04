Module OriginalPaths
    Public Function 将路径转换为FFmpeg滤镜接受的格式(path As String) As String
        If String.IsNullOrEmpty(path) Then
            Return path
        End If
        If path.StartsWith("\\") Then
            Dim pathAfterPrefix As String = path.Substring(2)
            pathAfterPrefix = pathAfterPrefix.Replace("\", "\\")
            Return "\\" & pathAfterPrefix
        End If
        If path.Length >= 2 AndAlso path(1) = ":"c Then
            Dim driveLetter As String = path.Substring(0, 1)
            Dim pathAfterDrive As String = path.Substring(2)
            pathAfterDrive = pathAfterDrive.Replace("\", "\\")
            Return driveLetter & "\:" & pathAfterDrive
        End If
        Return path.Replace("\", "\\")
    End Function
End Module
