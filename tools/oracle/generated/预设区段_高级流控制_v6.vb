Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports System.Globalization
Imports System.Text.RegularExpressions

Partial Public Class 预设管理_v6
    Private Shared Function 生成元数据章节附件片段(a As 预设数据_v6, 当前视频输出数量 As Integer, 输入文件 As String, 输出文件 As String, 当前字幕输出数量 As Integer) As 附加输出片段
        Dim result As New 附加输出片段
        Select Case a.流控制_元数据选项
            Case 预设数据_v6.流控制元数据选项.保留元数据
                result.输出前.Add("-map_metadata 0")
            Case 预设数据_v6.流控制元数据选项.清除元数据
                result.输出前.Add("-map_metadata -1")
            Case 预设数据_v6.流控制元数据选项.保留更多元数据
                result.输出前.Add("-map_metadata 0 -movflags +use_metadata_tags")
        End Select

        For Each item In If(a.元数据_要写入的信息, Array.Empty(Of 预设数据_v6.元数据单片结构)())
            If item Is Nothing Then Continue For
            Dim 字段 = item.字段.Trim()
            If 字段 = "" Then Continue For
            Dim 元数据表达式 = 应用自定义参数通配字符串(字段 & "=" & If(item.值, ""), 输入文件, 输出文件)
            result.输出前.Add($"-metadata {QMetadata(元数据表达式)}")
        Next

        Select Case a.流控制_章节选项
            Case 预设数据_v6.流控制章节选项.保留章节
                result.输出前.Add("-map_chapters 0")
            Case 预设数据_v6.流控制章节选项.清除章节
                result.输出前.Add("-map_chapters -1")
        End Select

        If a.章节_来源 <> 预设数据_v6.章节来源.未选择 AndAlso a.章节_文件路径.Trim() <> "" Then
            Dim inputIndex = 1 + result.额外输入.Where(Function(x) x = "-i").Count()
            Select Case a.章节_来源
                Case 预设数据_v6.章节来源.文本文档
                    result.额外输入.Add("-f ffmetadata")
                    result.额外输入.Add("-i")
                    result.额外输入.Add(Q(应用转译模式路径(a.章节_文件路径.Trim())))
                    result.输出前.Add($"-map_metadata {inputIndex}")
                    result.输出前.Add($"-map_chapters {inputIndex}")
                Case 预设数据_v6.章节来源.媒体文件
                    result.额外输入.Add("-i")
                    result.额外输入.Add(Q(应用转译模式路径(a.章节_文件路径.Trim())))
                    result.输出前.Add($"-map_chapters {inputIndex}")
            End Select
        End If

        Dim 允许常规附件 = 输出容器支持附件(a, 输出文件)
        Dim 允许附加封面图 = 输出容器支持附加封面图(a, 输出文件)
        Select Case a.流控制_附件选项
            Case 预设数据_v6.流控制附件选项.保留附件
                If 允许常规附件 Then
                    result.输出前.Add("-map 0:t? -c:t copy")
                    result.包含显式流映射 = True
                End If
        End Select

        Dim 额外输入索引 = 1 + result.额外输入.Where(Function(x) x = "-i").Count()
        添加自动混流字幕片段(a, 输入文件, 输出文件, result, 额外输入索引, 当前字幕输出数量)

        Dim 封面序号 As Integer = 0
        Dim 附件序号 As Integer = 0
        For Each item In If(a.附件_要写入的附件, Array.Empty(Of 预设数据_v6.附件单片结构)())
            If item Is Nothing OrElse item.文件路径.Trim() = "" OrElse item.类型 = 预设数据_v6.附件单片结构.附件类型.未选择 Then Continue For
            Dim 附件路径 = 应用转译模式路径(item.文件路径.Trim())
            Select Case item.类型
                Case 预设数据_v6.附件单片结构.附件类型.MP4封面图
                    If Not 允许附加封面图 Then Continue For
                    If 当前视频输出数量 < 0 Then Continue For
                    result.额外输入.Add("-i")
                    result.额外输入.Add(Q(附件路径))
                    Dim 输出视频序号 = 当前视频输出数量 + 封面序号
                    Dim 封面视频流 = $"{额外输入索引}:v:0"
                    result.输出前.Add($"-map {可选输入流映射(封面视频流)}")
                    result.包含显式流映射 = True
                    result.输出前.Add($"-c:v:{输出视频序号} copy")
                    result.输出前.Add($"-disposition:v:{输出视频序号} attached_pic")
                    result.附加封面图数量 += 1
                    额外输入索引 += 1
                    封面序号 += 1
                Case 预设数据_v6.附件单片结构.附件类型.MKV封面图,
                     预设数据_v6.附件单片结构.附件类型.图片,
                     预设数据_v6.附件单片结构.附件类型.字体文件,
                     预设数据_v6.附件单片结构.附件类型.文本文档
                    If Not 允许常规附件 Then Continue For
                    result.输出前.Add($"-attach {Q(附件路径)}")
                    result.输出前.Add($"-metadata:s:t:{附件序号} mimetype={获取附件Mimetype(附件路径, item.类型)}")
                    If item.类型 = 预设数据_v6.附件单片结构.附件类型.MKV封面图 Then
                        result.输出前.Add($"-metadata:s:t:{附件序号} filename=cover{Path.GetExtension(附件路径)}")
                    Else
                        result.输出前.Add($"-metadata:s:t:{附件序号} {QMetadata("filename=" & 获取路径文件名保持分隔符(附件路径))}")
                    End If
                    附件序号 += 1
            End Select
        Next

        Return result
    End Function

    Private Shared Function 输出容器支持附件(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "mkv", "mka", "mks", "mk3d"
                Return True
            Case Else
                Return False
        End Select
    End Function

    Private Shared Function 输出容器支持附加封面图(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "mp4", "m4v", "m4a", "mov", "3gp", "3g2", "mkv", "mka", "mks", "mk3d"
                Return True
            Case Else
                Return False
        End Select
    End Function

    Private Shared Function 输出容器支持MovText字幕(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "mp4", "m4v", "m4a", "mov", "3gp", "3g2"
                Return True
            Case Else
                Return False
        End Select
    End Function

    Private Shared Function 输出容器支持WebVtt字幕(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "webm"
                Return True
            Case Else
                Return False
        End Select
    End Function

    Private Shared Function 附加片段默认映射主视频(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma", "mka", "srt", "ass", "ssa", "vtt", "sup", "jpg", "jpeg", "jxl", "png", "webp", "bmp", "gif", "raw", "yuv", "h264", "h265", "hevc", "av1", "ivf"
                Return False
            Case Else
                Return True
        End Select
    End Function

    Private Shared Function 附加片段默认映射主音频(a As 预设数据_v6, 输出文件 As String) As Boolean
        Select Case 获取输出容器扩展名(a, 输出文件)
            Case "jpg", "jpeg", "jxl", "png", "webp", "bmp", "gif", "srt", "ass", "ssa", "vtt", "sup", "raw", "yuv", "h264", "h265", "hevc", "av1", "ivf"
                Return False
            Case Else
                Return True
        End Select
    End Function

    Private Shared Function 获取输出容器扩展名(a As 预设数据_v6, 输出文件 As String) As String
        Dim ext = Path.GetExtension(If(输出文件, "")).TrimStart("."c).ToLowerInvariant()
        If ext = "" OrElse 输出文件 = 输出占位符 OrElse 输出文件 = "<OutputFile>" Then ext = If(a?.输出容器, "").Trim().TrimStart("."c).ToLowerInvariant()
        Return ext
    End Function

    Private Shared Sub 添加自动混流字幕片段(a As 预设数据_v6, 输入文件 As String, 输出文件 As String, result As 附加输出片段, ByRef 额外输入索引 As Integer, 当前字幕输出数量 As Integer)
        If Not a.流控制_自动混流SRT AndAlso Not a.流控制_自动混流ASS AndAlso Not a.流控制_自动混流SSA Then Exit Sub

        Dim 自动字幕序号 As Integer = 0
        For Each 字幕文件 In 获取自动混流字幕文件(a, 输入文件)
            result.额外输入.Add("-i")
            result.额外输入.Add(Q(应用转译模式路径(字幕文件)))
            result.输出前.Add($"-map {可选输入流映射($"{额外输入索引}:0")}")
            result.包含显式流映射 = True

            Dim 字幕编码 = 获取自动混流字幕编码(a, 输出文件)
            If 当前字幕输出数量 >= 0 AndAlso 字幕编码 <> "" Then
                result.输出前.Add($"-c:s:{当前字幕输出数量 + 自动字幕序号} {字幕编码}")
                result.自动混流字幕数量 += 1
            ElseIf 当前字幕输出数量 < 0 AndAlso 字幕编码 <> "" Then
                result.输出前.Add($"-c:s {字幕编码}")
            End If

            额外输入索引 += 1
            自动字幕序号 += 1
        Next
    End Sub

    Private Shared Function 获取自动混流字幕编码(a As 预设数据_v6, 输出文件 As String) As String
        If 输出容器支持MovText字幕(a, 输出文件) Then Return "mov_text"
        If 输出容器支持WebVtt字幕(a, 输出文件) Then Return "webvtt"
        Return 获取容器兼容字幕编码(If(a.流控制_自动混流的字幕转为MOVTEXT, "mov_text", "copy"), a, 输出文件, True)
    End Function

    Private Shared Function 获取自动混流字幕文件(a As 预设数据_v6, 输入文件 As String) As List(Of String)
        Dim result As New List(Of String)
        If a.流控制_自动混流SRT Then 添加自动混流字幕候选(result, 输入文件, ".srt")
        If a.流控制_自动混流ASS Then 添加自动混流字幕候选(result, 输入文件, ".ass")
        If a.流控制_自动混流SSA Then 添加自动混流字幕候选(result, 输入文件, ".ssa")
        Return result.Distinct(StringComparer.OrdinalIgnoreCase).ToList()
    End Function

    Private Shared Sub 添加自动混流字幕候选(result As List(Of String), 输入文件 As String, ext As String)
        Dim path = 派生同名字幕路径(输入文件, ext)
        If path = "" Then Exit Sub
        If 是输入文件占位符(输入文件) OrElse File.Exists(path) Then result.Add(path)
    End Sub

    Private Shared Function 派生同名字幕路径(输入文件 As String, ext As String) As String
        If 是输入文件占位符(输入文件) Then Return "<InputFileWithOutExtension>" & ext
        Dim stem = 获取路径不含扩展名保持分隔符(输入文件)
        If String.IsNullOrWhiteSpace(stem) Then Return ""
        Return stem & ext
    End Function

    Private Shared Function 是输入文件占位符(输入文件 As String) As Boolean
        Dim value = If(输入文件, "").Trim()
        Return value = 输入占位符 OrElse value = "<InputFile>"
    End Function

    Private Shared Function 获取字幕编码参数(value As 预设数据_v6.流控制字幕操作) As String
        Select Case value
            Case 预设数据_v6.流控制字幕操作.复制流
                Return "copy"
            Case 预设数据_v6.流控制字幕操作.转为_mov_text
                Return "mov_text"
            Case 预设数据_v6.流控制字幕操作.转为_srt
                Return "srt"
            Case 预设数据_v6.流控制字幕操作.转为_ass
                Return "ass"
            Case 预设数据_v6.流控制字幕操作.转为_ssa
                Return "ssa"
            Case Else
                Return ""
        End Select
    End Function

    Private Shared Function 获取附件Mimetype(file As String, 类型 As 预设数据_v6.附件单片结构.附件类型) As String
        Dim ext = Path.GetExtension(If(file, "")).TrimStart("."c).ToLowerInvariant()
        Select Case ext
            Case "jpg", "jpeg"
                Return "image/jpeg"
            Case "jxl"
                Return "image/jxl"
            Case "png"
                Return "image/png"
            Case "webp"
                Return "image/webp"
            Case "bmp"
                Return "image/bmp"
            Case "gif"
                Return "image/gif"
            Case "ttf"
                Return "application/x-truetype-font"
            Case "otf"
                Return "application/vnd.ms-opentype"
            Case "ttc"
                Return "application/x-font-ttf"
            Case "woff"
                Return "font/woff"
            Case "woff2"
                Return "font/woff2"
            Case "txt", "md", "nfo"
                Return "text/plain"
            Case "json"
                Return "application/json"
            Case "xml"
                Return "application/xml"
            Case Else
                Select Case 类型
                    Case 预设数据_v6.附件单片结构.附件类型.字体文件
                        Return "application/octet-stream"
                    Case 预设数据_v6.附件单片结构.附件类型.文本文档
                        Return "text/plain"
                    Case Else
                        Return "application/octet-stream"
                End Select
        End Select
    End Function

    Private Shared Function 规范流列表(values As IEnumerable(Of String), 类型 As String) As List(Of String)
        Dim result As New List(Of String)
        If values Is Nothing Then Return result
        For Each raw In values
            For Each item In If(raw, "").Split(separator, StringSplitOptions.RemoveEmptyEntries)
                Dim s = item.Trim()
                If s = "" Then Continue For
                If s.Contains(":"c) Then
                    result.Add(s)
                Else
                    result.Add($"0:{类型}:{s}")
                End If
            Next
        Next
        Return result.Distinct().ToList()
    End Function
    Private Shared Function 获取容器兼容字幕编码(字幕编码 As String, a As 预设数据_v6, 输出文件 As String, 自动混流 As Boolean) As String
        Dim codec = If(字幕编码, "").Trim()
        If codec = "" Then Return ""

        If 输出容器支持MovText字幕(a, 输出文件) Then
            If codec = "copy" AndAlso Not 自动混流 Then Return codec
            Return "mov_text"
        End If

        If 输出容器支持WebVtt字幕(a, 输出文件) Then
            If codec = "copy" AndAlso Not 自动混流 Then Return codec
            Return "webvtt"
        End If

        If 输出容器支持附件(a, 输出文件) AndAlso String.Equals(codec, "mov_text", StringComparison.OrdinalIgnoreCase) Then Return "copy"
        Return codec
    End Function


End Class
