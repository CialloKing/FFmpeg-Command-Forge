Imports System.IO
Imports System.Text
Imports System.Text.Json
Imports System.Globalization
Imports System.Text.RegularExpressions

Partial Public Class 预设管理_v6
    Public Shared Sub 初始化空集合(a As 预设数据_v6)
        If a Is Nothing Then Exit Sub
        If a.视频参数_超分_直接面板 Is Nothing Then a.视频参数_超分_直接面板 = New 预设数据_v6.超分数据单片结构
        If a.视频参数_超分_滤镜叠加策略组 Is Nothing Then a.视频参数_超分_滤镜叠加策略组 = Array.Empty(Of 预设数据_v6.超分数据单片结构)()
        If a.滤镜排序系统 Is Nothing Then a.滤镜排序系统 = Array.Empty(Of 预设数据_v6.滤镜排序单片结构)()
        If a.元数据_要写入的信息 Is Nothing Then a.元数据_要写入的信息 = Array.Empty(Of 预设数据_v6.元数据单片结构)()
        If a.附件_要写入的附件 Is Nothing Then a.附件_要写入的附件 = Array.Empty(Of 预设数据_v6.附件单片结构)()
        If a.流控制_将视频参数应用于指定流 Is Nothing Then a.流控制_将视频参数应用于指定流 = Array.Empty(Of String)()
        If a.流控制_将音频参数应用于指定流 Is Nothing Then a.流控制_将音频参数应用于指定流 = Array.Empty(Of String)()
        If a.流控制_将字幕参数应用于指定流 Is Nothing Then a.流控制_将字幕参数应用于指定流 = Array.Empty(Of String)()
        If a.视频参数_烧录字幕_字幕格式优先级 Is Nothing Then a.视频参数_烧录字幕_字幕格式优先级 = New List(Of 预设数据_v6.烧字幕格式)
        If a.视频参数_烧录字幕_主要颜色 Is Nothing Then a.视频参数_烧录字幕_主要颜色 = New 预设数据_v6.烧字幕专用颜色类型
        If a.视频参数_烧录字幕_次要颜色 Is Nothing Then a.视频参数_烧录字幕_次要颜色 = New 预设数据_v6.烧字幕专用颜色类型
        If a.视频参数_烧录字幕_描边颜色 Is Nothing Then a.视频参数_烧录字幕_描边颜色 = New 预设数据_v6.烧字幕专用颜色类型
        If a.视频参数_烧录字幕_背景颜色 Is Nothing Then a.视频参数_烧录字幕_背景颜色 = New 预设数据_v6.烧字幕专用颜色类型
        迁移旧自定义滤镜字段到排序系统(a)
        同步内置滤镜排序数据(a)
    End Sub
End Class
