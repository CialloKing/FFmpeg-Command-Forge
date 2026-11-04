Imports System.Text.Json
Imports System.Text.Json.Serialization
Imports System.Reflection
Imports System.Runtime.InteropServices

Module Program
    Public ReadOnly JsonSO As New JsonSerializerOptions With {.WriteIndented = True, .Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping}
    Sub Main(args As String())
        Console.InputEncoding = New System.Text.UTF8Encoding(False)
        Console.OutputEncoding = New System.Text.UTF8Encoding(False)
        JsonSO.Converters.Add(New JsonStringEnumConverter())
        If args.Contains("--times") Then
            Dim parsed = args.Skip(1).Select(Function(value)
                                                Dim span As TimeSpan
                                                Dim ok = TimeSpan.TryParse(value, Globalization.CultureInfo.InvariantCulture, span)
                                                Return New With {.text = value, .ok = ok, .seconds = If(ok, span.TotalSeconds, 0)}
                                            End Function).ToArray()
            Console.WriteLine(JsonSerializer.Serialize(parsed, JsonSO))
            Return
        End If
        If args.Contains("--schema") Then
            Dim data As New 预设数据_v6
            预设管理_v6.初始化空集合(data)
            Dim result = New With {
                .defaults = data,
                .schema = Describe(GetType(预设数据_v6)),
                .video = 视频编码器数据库_v6.全部编码器,
                .audio = 音频编码器数据库_v6.全部编码器,
                .builtins = 开发者内置预设_v6.获取全部()
            }
            Console.WriteLine(JsonSerializer.Serialize(result, JsonSO))
            Return
        End If
        If args.Contains("--argv") Then
            Dim native = SplitNative(Environment.CommandLine).Skip(1).ToArray()
            Console.WriteLine(JsonSerializer.Serialize(native, JsonSO))
            Return
        End If
        Dim line As String = Console.ReadLine()
        While line IsNot Nothing
            Try
                Using doc = JsonDocument.Parse(line)
                    Dim request = doc.RootElement
                    Dim a = JsonSerializer.Deserialize(Of 预设数据_v6)(request.GetProperty("preset").GetRawText(), JsonSO)
                    Dim input = request.GetProperty("input").GetString()
                    Dim output = request.GetProperty("output").GetString()
                    Dim duration As JsonElement
                    Dim durationText = If(request.TryGetProperty("duration", duration), duration.ToString(), "")
                    Dim result = 预设管理_v6.生成阶段化命令行(a, input, output, durationText)
                    Console.WriteLine(JsonSerializer.Serialize(result, New JsonSerializerOptions(JsonSO) With {.WriteIndented = False}))
                End Using
            Catch ex As Exception
                Console.WriteLine(JsonSerializer.Serialize(New With {.error = ex.Message}))
            End Try
            line = Console.ReadLine()
        End While
    End Sub

    Function Describe(t As Type) As Object
        If t.IsEnum Then Return New With {.kind = "enum", .values = [Enum].GetNames(t).ToDictionary(Function(n) n, Function(n) Convert.ToInt32([Enum].Parse(t, n)))}
        If t = GetType(String) Then Return New With {.kind = "string"}
        If t = GetType(Boolean) Then Return New With {.kind = "boolean"}
        If t.IsPrimitive Then Return New With {.kind = "number"}
        If t.IsArray Then Return New With {.kind = "array", .items = Describe(t.GetElementType())}
        If t.IsGenericType Then Return New With {.kind = "array", .items = Describe(t.GetGenericArguments()(0))}
        Dim defaults = JsonSerializer.SerializeToNode(Activator.CreateInstance(t), JsonSO)
        If defaults IsNot Nothing AndAlso t.GetProperty("实例ID") IsNot Nothing Then defaults("实例ID") = System.Text.Json.Nodes.JsonValue.Create("")
        Return New With {.kind = "object", .defaults = defaults, .fields = t.GetProperties().Where(Function(p) p.GetCustomAttribute(Of JsonIgnoreAttribute)() Is Nothing).ToDictionary(Function(p) p.Name, Function(p) Describe(p.PropertyType))}
    End Function

    <DllImport("shell32.dll", CharSet:=CharSet.Unicode, SetLastError:=True)>
    Private Function CommandLineToArgvW(command As String, ByRef count As Integer) As IntPtr
    End Function
    <DllImport("kernel32.dll")>
    Private Function LocalFree(p As IntPtr) As IntPtr
    End Function
    Function SplitNative(command As String) As String()
        Dim count As Integer
        Dim p = CommandLineToArgvW(command, count)
        Try
            Return Enumerable.Range(0, count).Select(Function(i) Marshal.PtrToStringUni(Marshal.ReadIntPtr(p, i * IntPtr.Size))).ToArray()
        Finally
            LocalFree(p)
        End Try
    End Function
    Public Function 转译模式处理路径(value As String) As String
        Return value
    End Function
End Module

Partial Public Class 预设管理_v6
    Public Shared Function 克隆预设数据(source As 预设数据_v6) As 预设数据_v6
        Return JsonSerializer.Deserialize(Of 预设数据_v6)(JsonSerializer.Serialize(source, JsonSO), JsonSO)
    End Function
End Class

Public Class 设置_v6
    Public Shared Property 实例对象 As New 设置_v6
    Public Property 转译模式 As Boolean = False
    Public Property 自定义视频编码器列表 As New List(Of String)
    Public Shared Function 获取FFmpeg进程文件名() As String
        Return "ffmpeg"
    End Function
    Public Shared Function 获取FFprobe进程文件名() As String
        Return "ffprobe"
    End Function
End Class
