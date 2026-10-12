# 人声报拍采样

当前四个报拍来自用户指定的本地文件 `基础节拍器 wav/练习曲（1）伴奏.wav`。提取最开头四个数字，替换此前的 Freesound 英语与日语人声。这里只记录用户提供的来源，不沿用旧素材的 CC0 授权声明。

- 原文件：立体声、48 kHz、24-bit PCM，80 BPM。
- 截取时间（秒）：One 0–0.240；Two 0.744–0.980；Three 1.497–1.757；Four 2.246–2.513。
- 转换为单声道 22050 Hz / 16-bit PCM，保留音高；每段最长约 240 ms，做短淡入淡出与峰值归一化，以适配 40–240 BPM。
- 四个 WAV 随项目提供，播放无需网络。按 2/4、3/4、4/4 循环读到对应拍数；开启首拍重音时，其余拍使用首拍的 80% 音量。
- 旧日语人声音色已移除；保存过该选项的设备会恢复为当前人声报拍。

重新制作（需要 FFmpeg；传入原始文件路径）：

```sh
python3 scripts/prepare-voice.py "/path/to/练习曲（1）伴奏.wav"
```

## 美式英语女声

采用用户选定的试听 B：[countdown.wav](https://freesound.org/people/tim.kahn/sounds/82986/)，作者 tim.kahn，授权 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。小程序“设置与帮助”中保留作者、来源、授权及修改说明。

修改：将原倒数录音剪辑、重排为 One、Two、Three、Four，转换为单声道 22050 Hz / 16-bit PCM；调整时长、音量及淡入淡出。截取区间与试听 B 相同：One 10.30–10.88 秒；Two 9.15–9.70 秒；Three 7.95–8.95 秒；Four 6.78–7.60 秒。

`female/60`、`90`、`120`、`180`、`240` 分别提供适配该 BPM 的版本，播放时选择不低于当前 BPM 的最小档位。低速尽量保留原速，只有无法放进单拍的数字才用 FFmpeg `atempo` 保留音高并缩短时长；每段最多占档位拍长的 96%，避免相邻数字重叠。新女声与伴奏文件提取的人声分别缓存、选择和保存。

重新制作：

```sh
curl -L --fail 'https://cdn.freesound.org/previews/82/82986_7037-hq.mp3' -o /tmp/female-count-b.mp3
python3 scripts/prepare-female-voice.py /tmp/female-count-b.mp3
```
