Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports System.Globalization
Imports System.Text.RegularExpressions

Partial Public Class 预设管理_v6
    Private Shared Function 构造缩放滤镜(a As 预设数据_v6) As String
        Dim 缩放滤镜 = If(a.视频参数_分辨率自动计算_缩放滤镜, "").Trim().ToLowerInvariant()
        Dim 使用CUDA = String.Equals(缩放滤镜, "scale_cuda", StringComparison.Ordinal)
        Dim 缩放算法 = If(a.视频参数_分辨率自动计算_缩放算法, "").Trim()
        If 使用CUDA AndAlso Not {"nearest", "bilinear", "bicubic", "lanczos"}.Contains(缩放算法, StringComparer.OrdinalIgnoreCase) Then 缩放算法 = ""
        Dim 缩放参数 = If(缩放算法 = "", "", If(使用CUDA, ":interp_algo=" & 缩放算法, ":flags=" & 缩放算法))
        If a.视频参数_分辨率 <> "" Then
            Dim 分辨率 = a.视频参数_分辨率.Trim().Replace("X", "x", StringComparison.Ordinal)
            If 使用CUDA AndAlso 分辨率.Contains("x", StringComparison.Ordinal) Then
                Dim 尺寸 = 分辨率.Split("x"c)
                If 尺寸.Length >= 2 Then Return $"scale_cuda=w={尺寸(0)}:h={尺寸(1)}{缩放参数}"
            End If
            Return $"scale={分辨率.Replace("x", ":")}{缩放参数}"
        End If

        Dim 宽度 = If(a.视频参数_分辨率自动计算_宽度, "")
        Dim 高度 = If(a.视频参数_分辨率自动计算_高度, "")
        If 宽度 = "" AndAlso 高度 = "" Then Return ""
        If 宽度 = "" Then 宽度 = "-2"
        If 高度 = "" Then 高度 = "-2"
        If 使用CUDA Then Return $"scale_cuda=w={宽度}:h={高度}{缩放参数}"
        Return $"scale={宽度}:{高度}{缩放参数}"
    End Function

    Private Shared Function 构造裁剪滤镜(a As 预设数据_v6) As String
        Dim value = If(a.视频参数_分辨率_裁剪滤镜参数, "").Trim()
        Return If(value <> "", "crop=" & value, "")
    End Function

    Private Shared Function 构造抽帧滤镜(a As 预设数据_v6) As String
        Dim opts As New List(Of String)
        If a.视频参数_抽帧_max <> "" Then opts.Add("max=" & a.视频参数_抽帧_max)
        If a.视频参数_抽帧_keep <> "" Then opts.Add("keep=" & a.视频参数_抽帧_keep)
        If a.视频参数_抽帧_hi <> "" Then opts.Add("hi=" & a.视频参数_抽帧_hi)
        If a.视频参数_抽帧_lo <> "" Then opts.Add("lo=" & a.视频参数_抽帧_lo)
        If a.视频参数_抽帧_frac <> "" Then opts.Add("frac=" & a.视频参数_抽帧_frac)
        Return If(opts.Count > 0, "mpdecimate=" & String.Join(":", opts), "")
    End Function

    Private Shared Function 构造插帧滤镜(a As 预设数据_v6) As String
        If a.视频参数_插帧_目标帧率 = "" Then Return ""
        Dim opts As New List(Of String) From {$"fps={a.视频参数_插帧_目标帧率}"}
        Dim 插帧模式 = 插帧模式参数值(a.视频参数_插帧_插帧模式)
        Dim 运动估计模式 = 运动估计模式参数值(a.视频参数_插帧_运动估计模式)
        Dim 运动估计算法 = 运动估计算法参数值(a.视频参数_插帧_运动估计算法)
        Dim 运动补偿模式 = 运动补偿模式参数值(a.视频参数_插帧_运动补偿模式)
        If 插帧模式 <> "" Then opts.Add("mi_mode=" & 插帧模式)
        If 运动估计模式 <> "" Then opts.Add("me_mode=" & 运动估计模式)
        If 运动估计算法 <> "" Then opts.Add("me=" & 运动估计算法)
        If 运动补偿模式 <> "" Then opts.Add("mc_mode=" & 运动补偿模式)
        If a.视频参数_插帧_可变块大小的运动补偿 Then opts.Add("vsbmc=1")
        If a.视频参数_插帧_块大小 <> "" Then opts.Add("mb_size=" & a.视频参数_插帧_块大小)
        If a.视频参数_插帧_搜索范围 <> "" Then opts.Add("search_param=" & a.视频参数_插帧_搜索范围)
        If a.视频参数_插帧_场景变化检测强度 <> "" Then opts.Add("scd_threshold=" & a.视频参数_插帧_场景变化检测强度)
        Return "minterpolate=" & String.Join(":", opts)
    End Function

    Private Shared Function 构造NVFRUC滤镜(a As 预设数据_v6) As String
        If a Is Nothing OrElse String.IsNullOrWhiteSpace(a.视频参数_NV_FRUC_目标帧率) Then Return ""
        Dim opts As New List(Of String) From {"fps=" & a.视频参数_NV_FRUC_目标帧率.Trim()}
        Dim perf = If(a.视频参数_NV_FRUC_质量和速度, "").Trim().ToLowerInvariant()
        If {"slow", "medium", "fast"}.Contains(perf) Then opts.Add("perf=" & perf)
        Dim grid = If(a.视频参数_NV_FRUC_网格大小, "").Trim().ToLowerInvariant()
        If {"auto", "1", "2", "4", "8"}.Contains(grid) Then opts.Add("grid=" & grid)
        Return "fruc_vulkan=" & String.Join(":", opts)
    End Function

    Private Shared Function 构造动态模糊滤镜(a As 预设数据_v6) As String
        If a.视频参数_动态模糊_连续混合帧数 = "" Then Return ""
        Dim opts As New List(Of String) From {$"frames={a.视频参数_动态模糊_连续混合帧数}"}
        If a.视频参数_动态模糊_每帧权重 <> "" Then opts.Add("weights=" & a.视频参数_动态模糊_每帧权重)
        If a.视频参数_动态模糊_输出缩放系数 <> "" Then opts.Add("scale=" & a.视频参数_动态模糊_输出缩放系数)
        If a.视频参数_动态模糊_处理颜色平面 <> "" Then opts.Add("planes=" & a.视频参数_动态模糊_处理颜色平面)
        Return "tmix=" & String.Join(":", opts)
    End Function

    Private Shared Function 构造超分滤镜(a As 预设数据_v6) As String
        Dim list As New List(Of 预设数据_v6.超分数据单片结构)
        If a.视频参数_超分_滤镜叠加策略组 IsNot Nothing AndAlso a.视频参数_超分_滤镜叠加策略组.Length > 0 Then
            list.AddRange(a.视频参数_超分_滤镜叠加策略组)
        ElseIf a.视频参数_超分_直接面板 IsNot Nothing Then
            list.Add(a.视频参数_超分_直接面板)
        End If
        Dim filters As New List(Of String)
        For Each s In list
            If s Is Nothing Then Continue For
            Dim 目标宽度 = If(s.目标宽度, "")
            Dim 目标高度 = If(s.目标高度, "")
            Dim libplaceboOpts As New List(Of String)
            If 目标宽度 <> "" Then libplaceboOpts.Add("w=" & 目标宽度)
            If 目标高度 <> "" Then libplaceboOpts.Add("h=" & 目标高度)
            If s.上采样算法 <> "" Then libplaceboOpts.Add("upscaler=" & s.上采样算法)
            If s.下采样算法 <> "" Then libplaceboOpts.Add("downscaler=" & s.下采样算法)
            If s.抗振铃强度 <> "" Then libplaceboOpts.Add("antiringing=" & s.抗振铃强度)
            If s.着色器文件路径 <> "" Then libplaceboOpts.Add($"custom_shader_path='{转义字幕滤镜值(应用转译模式路径(s.着色器文件路径))}'")
            If libplaceboOpts.Count > 0 Then
                filters.Add("libplacebo=" & String.Join(":", libplaceboOpts))
            End If
        Next
        Return String.Join(",", filters)
    End Function

    Private Shared Function 构造降噪滤镜(a As 预设数据_v6) As String
        Select Case a.视频参数_降噪_方式
            Case 预设数据_v6.降噪方式.hqdn3d
                Return $"hqdn3d={JoinNonEmpty(":", a.视频参数_降噪_参数1, a.视频参数_降噪_参数2, a.视频参数_降噪_参数3, a.视频参数_降噪_参数4)}".TrimEnd("="c)
            Case 预设数据_v6.降噪方式.nlmeans
                Return $"nlmeans={JoinNamed(":", ("s", a.视频参数_降噪_参数1), ("p", a.视频参数_降噪_参数2), ("pc", a.视频参数_降噪_参数3), ("r", a.视频参数_降噪_参数4))}".TrimEnd("="c)
            Case 预设数据_v6.降噪方式.atadenoise
                Return $"atadenoise={JoinNamed(":", ("0a", a.视频参数_降噪_参数1), ("0b", a.视频参数_降噪_参数2), ("1a", a.视频参数_降噪_参数3), ("1b", a.视频参数_降噪_参数4))}".TrimEnd("="c)
            Case 预设数据_v6.降噪方式.bm3d
                Return $"bm3d={JoinNamed(":", ("sigma", a.视频参数_降噪_参数1), ("block", a.视频参数_降噪_参数2), ("bstep", a.视频参数_降噪_参数3), ("group", a.视频参数_降噪_参数4))}".TrimEnd("="c)
            Case 预设数据_v6.降噪方式.bilateral_cuda
                Return $"bilateral_cuda={JoinNamed(":", ("sigmaS", a.视频参数_降噪_参数1), ("sigmaR", a.视频参数_降噪_参数2), ("window_size", a.视频参数_降噪_参数3))}".TrimEnd("="c)
        End Select
        Return ""
    End Function

    Private Shared Function 构造锐化滤镜(a As 预设数据_v6) As String
        Select Case a.视频参数_锐化_方式
            Case 预设数据_v6.锐化方式.cas
                Return $"cas={JoinNamed(":", ("strength", a.视频参数_锐化_参数1), ("planes", a.视频参数_锐化_参数2))}".TrimEnd("="c)
            Case 预设数据_v6.锐化方式.unsharp
                Return $"unsharp={JoinNonEmpty(":", a.视频参数_锐化_参数1, a.视频参数_锐化_参数2, a.视频参数_锐化_参数3)}".TrimEnd("="c)
        End Select
        Return ""
    End Function

    Private Shared Function 构造胶片颗粒滤镜(a As 预设数据_v6) As String
        Select Case a.视频参数_胶片颗粒_方式
            Case 预设数据_v6.胶片颗粒方式.noise_全平面动态均匀颗粒
                Return 构造命名滤镜("noise",
                    ("alls", a.视频参数_胶片颗粒_参数1),
                    ("allf", If(a.视频参数_胶片颗粒_参数1 <> "", "t+u", "")),
                    ("all_seed", a.视频参数_胶片颗粒_参数2))
            Case 预设数据_v6.胶片颗粒方式.noise_亮度为主动态颗粒
                Return 构造命名滤镜("noise",
                    ("c0s", a.视频参数_胶片颗粒_参数1),
                    ("c0f", If(a.视频参数_胶片颗粒_参数1 <> "", "t+u", "")),
                    ("c1s", a.视频参数_胶片颗粒_参数2),
                    ("c1f", If(a.视频参数_胶片颗粒_参数2 <> "", "t+u", "")),
                    ("c2s", a.视频参数_胶片颗粒_参数2),
                    ("c2f", If(a.视频参数_胶片颗粒_参数2 <> "", "t+u", "")),
                    ("all_seed", a.视频参数_胶片颗粒_参数3))
            Case 预设数据_v6.胶片颗粒方式.noise_柔和平均颗粒
                Return 构造命名滤镜("noise",
                    ("alls", a.视频参数_胶片颗粒_参数1),
                    ("allf", If(a.视频参数_胶片颗粒_参数1 <> "", "t+a+u", "")),
                    ("all_seed", a.视频参数_胶片颗粒_参数2))
            Case 预设数据_v6.胶片颗粒方式.libplacebo_应用片源胶片颗粒元数据
                Return "libplacebo=apply_filmgrain=true"
        End Select
        Return ""
    End Function

    Private Shared Function JoinNonEmpty(delimiter As String, ParamArray values() As String) As String
        Return String.Join(delimiter, values.Where(Function(x) Not String.IsNullOrWhiteSpace(x)))
    End Function

    Private Shared Function JoinNamed(delimiter As String, ParamArray values() As (Name As String, Value As String)) As String
        Return String.Join(delimiter, values.Where(Function(x) Not String.IsNullOrWhiteSpace(x.Value)).Select(Function(x) $"{x.Name}={x.Value}"))
    End Function

    Private Shared Function 构造命名滤镜(名称 As String, ParamArray values() As (Name As String, Value As String)) As String
        Dim opts = JoinNamed(":", values)
        Return If(opts = "", 名称, 名称 & "=" & opts)
    End Function

    Private Class 滤镜图结果
        Public Property 滤镜图 As String = ""
        Public Property 映射参数 As String = ""
        Public Property 输出滤镜参数 As String = ""
        Public Property 编码视频选择器 As New List(Of String)
        Public Property 编码音频选择器 As New List(Of String)
        Public Property 视频输出数量 As Integer = 0
        Public Property 音频输出数量 As Integer = 0
        Public Property 字幕输出数量 As Integer = 0
        Public Property 请求视频输出 As Boolean = False
        Public Property 请求音频输出 As Boolean = False
        Public Property 请求字幕输出 As Boolean = False
        Public Property 视频输出来自滤镜 As Boolean = False
        Public Property 音频输出来自滤镜 As Boolean = False
    End Class
    Private Shared Function 标准化插帧选项值(value As String, ParamArray options() As (Text As String, Value As String)) As String
        Dim text = If(value, "").Trim()
        If text = "" Then Return ""
        For Each item In options
            If String.Equals(text, item.Text, StringComparison.Ordinal) OrElse
               String.Equals(text, item.Value, StringComparison.OrdinalIgnoreCase) Then
                Return item.Value
            End If
        Next
        Return text
    End Function

    Private Shared Function 插帧选项显示文本(value As String, ParamArray options() As (Text As String, Value As String)) As String
        Dim normalized = 标准化插帧选项值(value, options)
        If normalized = "" Then Return ""
        For Each item In options
            If String.Equals(normalized, item.Value, StringComparison.OrdinalIgnoreCase) Then Return item.Text
        Next
        Return normalized
    End Function

    Private Shared Function 插帧模式参数值(value As String) As String
        Return 标准化插帧选项值(value,
            ("两帧加权平均", "blend"),
            ("运动补偿插值", "mci"))
    End Function

    Private Shared Function 插帧模式显示文本(value As String) As String
        Return 插帧选项显示文本(value,
            ("两帧加权平均", "blend"),
            ("运动补偿插值", "mci"))
    End Function

    Private Shared Function 运动估计模式参数值(value As String) As String
        Return 标准化插帧选项值(value,
            ("双向运动估计", "bidir"),
            ("双侧运动估计", "bilat"))
    End Function

    Private Shared Function 运动估计模式显示文本(value As String) As String
        Return 插帧选项显示文本(value,
            ("双向运动估计", "bidir"),
            ("双侧运动估计", "bilat"))
    End Function

    Private Shared Function 运动估计算法参数值(value As String) As String
        Return 标准化插帧选项值(value,
            ("穷举搜索", "esa"),
            ("三步搜索", "tss"),
            ("二维对数搜索", "tdls"),
            ("新三步搜索", "ntss"),
            ("四步搜索", "fss"),
            ("菱形搜索", "ds"),
            ("基于 Hexagon", "hexbs"),
            ("增强的预测区域", "epzs"),
            ("不均匀多六边形", "umh"))
    End Function

    Private Shared Function 运动估计算法显示文本(value As String) As String
        Return 插帧选项显示文本(value,
            ("穷举搜索", "esa"),
            ("三步搜索", "tss"),
            ("二维对数搜索", "tdls"),
            ("新三步搜索", "ntss"),
            ("四步搜索", "fss"),
            ("菱形搜索", "ds"),
            ("基于 Hexagon", "hexbs"),
            ("增强的预测区域", "epzs"),
            ("不均匀多六边形", "umh"))
    End Function

    Private Shared Function 运动补偿模式参数值(value As String) As String
        Return 标准化插帧选项值(value,
            ("重叠块运动补偿", "obmc"),
            ("加权 obmc", "aobmc"))
    End Function

    Private Shared Function 运动补偿模式显示文本(value As String) As String
        Return 插帧选项显示文本(value,
            ("重叠块运动补偿", "obmc"),
            ("加权 obmc", "aobmc"))
    End Function

End Class
