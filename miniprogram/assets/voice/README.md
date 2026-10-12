# 人声报拍采样

- 来源：[A One, A Two](https://freesound.org/people/davidbain/sounds/135648/)，作者 davidbain，2011-11-22 发布。
- 原站标注 [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)，允许复制、修改与分发。保留此说明以记录来源。
- 使用原站提供的高质量 MP3 预览，截取末段 One、Two、Three、Four，去掉前导口令，转为单声道 22050 Hz / 16-bit PCM WAV。
- 每个数字保留音高并加速至约 235 ms，尾部最多保留 240 ms，适配 40–240 BPM；做短淡入淡出和峰值归一化。四个 WAV 随仓库分发，运行时无需网络或语音服务。
- 按当前拍号循环：2/4 为 One、Two；3/4 增加 Three；4/4 增加 Four。首拍重音开启时，其他拍使用首拍的 80% 音量；关闭时音量相同。

需要重新制作时，安装 FFmpeg，下载来源文件后运行：

```sh
curl -L --fail 'https://cdn.freesound.org/previews/135/135648_2207512-hq.mp3' -o /tmp/metronome-count.mp3
python3 scripts/prepare-voice.py /tmp/metronome-count.mp3
```

脚本生成标准 44 字节 WAV 头，可由项目共用的 PCM 解码器读取。普通电子/柔和音色仍使用原有合成音。

## 日语女声

- 来源：[Chorused Countup- Japanese](https://freesound.org/people/isitlocal/sounds/220213/)，作者 isitlocal，2014-02-22 发布；原站标注 CC0 1.0。作者说明来自 Vocaloid 音色包，带合唱效果，为合成女声。
- 使用原站高质量 MP3 预览，截取前段四个报数，移除开头与结尾静音。`japanese/one.wav` 至 `four.wav` 对应第 1–4 拍；文件名用于共用报拍逻辑。
- 与英语组一致，转换为单声道 22050 Hz / 16-bit PCM，保留音高并缩短至约 235 ms、最多 240 ms，做淡入淡出与峰值归一化。
- 音色选项“人声报拍（日语女声）”使用这一组采样，同样支持拍号、首拍重音、本地记忆与后台整段播放。

重新制作：

```sh
curl -L --fail 'https://cdn.freesound.org/previews/220/220213_2907755-hq.mp3' -o /tmp/metronome-japanese.mp3
python3 scripts/prepare-voice.py /tmp/metronome-japanese.mp3 --japanese
```
