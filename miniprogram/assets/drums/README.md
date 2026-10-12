# 本地鼓采样

来源：[99Sounds · 99 Drum Samples I](https://99sounds.org/drum-samples/)。仓库不分发原压缩包或转换后的 WAV；请从来源站点自行下载 `[99Sounds] 99 Drum Samples.zip`，在本地准备以下 6 个文件。普通节拍器不依赖这些素材。

| 鼓组 | 底鼓 | 军鼓 | 闭合踩镲 |
| --- | --- | --- | --- |
| 声学鼓 | kick-acoustic01.wav | snare-acoustic01.wav | hihat-acoustic01.wav |
| 808 电子鼓 | kick-808.wav | snare-808.wav | hihat-808.wav |

这 6 个文件由原始单声道 44.1 kHz、24 位 PCM 转换为单声道 22.05 kHz、16 位 PCM，总计 125,232 字节；仅转换这 6 个所需采样，不转换其余文件。使用对称低通 FIR 后降采样，保留声音起点。

下载后，将压缩包放在项目父目录，在仓库根目录运行（需要 Python 3.8 或更新版本）：

```sh
python3 scripts/prepare-drums.py
```

也可显式传入原压缩包路径：

```sh
python3 scripts/prepare-drums.py "/path/to/[99Sounds] 99 Drum Samples.zip"
```

生成文件写入本目录，并由 `.gitignore` 排除。准备完成后可使用鼓伴奏并运行 `node --test tests/*.test.js`；不要强制将这些 WAV 加入 Git。

原包 README.pdf 的 LICENSE 允许商业与非商业用途，但明确排除将素材用于另一个采样库或虚拟乐器。[99Sounds 官方授权页](https://99sounds.org/license/)另明确禁止单独再分发音频文件，即使免费也不允许。因此开源仓库仅保留转换脚本与文件名说明，不再分发素材；使用或发布包含这些声音的小程序前，仍需核对下载包及官方授权是否覆盖具体用途，必要时取得授权。

鼓伴奏按绝对采样位置安排击打并混音，保留跨分块和跨小节的采样尾部；为重叠声音预留固定余量，不通过连续切换短音频实现循环。
