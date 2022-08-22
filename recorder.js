class Recorder {
  audioContext = null
  analyser = null // 分析器
  recorder = null
  isRecording = false // 是否正在录音
  isPause = null // 是否是暂停
  duration = 0 // 录音时长
  audioData = [] // 音频数据
  transWorker = null
  audioInput = null // 音频源节点
  prevDomainData = null // 缓存之前的分析数据
  audioOffset = 0 // 用于记录之前获取音频的的位置
  currentMicDeviceId = ''
  constructor() {
    this.hasPermission = false
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)()
      if (!this.audioContext) {
        console.error('浏览器不支持webAudioApi相关接口')
        return
      }
    } catch(e) {
      if (!this.audioContext) {
        console.error('浏览器不支持webAudioApi相关接口')
        return
      }
    }
    // 提前请求授权
    navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
      stream.getTracks().forEach(track => track.stop())
    })
  }
  initRecorder() {
    if (this.audioContext) {
      this.destroy()
    }
    this.transWorker = new Worker('./transcode.worker.js')
    this.transWorker.onmessage = (event) => {
      this.audioData.push(...event.data)
    }
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 2048
    const createScript = this.audioContext.createScriptProcessor || this.audioContext.createJavaScriptNode
    this.recorder = createScript.apply(this.audioContext, [4096, 1, 1])
    this.recorder.onaudioprocess = e => {
      if (!this.isRecording || this.isPause) {
        // 不在录音时不需要处理，火狐在停止录音后，仍会触发 audioprocess 事件
        return
      }
      // 左声道数据
      // getChannelData返回Float32Array类型的pcm数据
      const lData = e.inputBuffer.getChannelData(0)
      const val = Math.max.apply(Math, lData) * 100
      this.duration += 4096 / 16000
      this.onprogress && this.onprogress({
        duration: this.duration,
        val: val,
      })
      // 把数据送给webworker处理
      this.transWorker.postMessage(lData)
    }
  }

  start(audioConstraints) {
    if (this.isRecording) {
      return
    }

    this.clearCache(true)
    this.initRecorder()
    this.isRecording = true
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return navigator.mediaDevices
        .getUserMedia({
          audio: audioConstraints || true,
          video: false,
        })
        .then(stream => {
          this.audioInput = this.audioContext.createMediaStreamSource(stream)
          this.stream = stream
          // audioInput 为声音源，连接到处理节点 recorder
          this.audioInput.connect(this.analyser)
          this.analyser.connect(this.recorder)
          // 处理节点 recorder 连接到扬声器
          this.recorder.connect(this.audioContext.destination)
        })
        .catch(e => {
          this.destroy()
          throw e
        })
    } else {
      if (navigator.userAgent.toLowerCase().match(/chrome/) && location.origin.indexOf('https://') < 0) {
        alert('chrome下获取浏览器录音功能，因为安全性问题，需要在localhost或127.0.0.1或https下才能获取权限')
      } else {
        alert('无法获取浏览器录音功能，请升级浏览器或使用chrome')
      }
      this.destroy()
      return
    }
  }

  pause() {
    if (this.isRecording && !this.isPause) {
      this.isPause = true
    }
  }

  resume() {
    if (this.isRecording && this.isPause) {
      THIS.isPause = false
    }
  }

  stop() {
    this.isRecording = false
    this.audioInput && this.audioInput.disconnect()
    this.recorder.disconnect()
  }

  /**
   * 获取当前的全部音频数据
   * @returns [DataView]
   */
  getWholeData() {
    return this.audioData
  }

  /**
   * 获取上次调用getNextData余下的数据
   */
  getNextData() {
    const length = this.audioData.length
    const data = this.audioData.slice(this.audioOffset)
    this.audioOffset = length
    return data
  }

  getRecordAnalyseData() {
    if (this.isPause) {
      // 暂停时不需要发送录音的数据，处理FF下暂停仍就获取录音数据的问题
      // 为防止暂停后，画面空白，故返回先前的数据
      return this.prevDomainData
    }
    let dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    // 将数据拷贝到dataArray中。
    this.analyser.getByteTimeDomainData(dataArray)

    return ( this.prevDomainData = dataArray)
  }

  getMicDevices() {
    return navigator.mediaDevices.enumerateDevices().then(res => {
      const devicesList = []
      let communicationsDevice = null
      let defaultDevice = null
      res.forEach((device, i) => {
        if (device.kind === 'audioinput') {
          if (device.deviceId !== 'default' && device.deviceId !== 'communications') {
            const info = JSON.parse(JSON.stringify(device))
            devicesList.push({
              ...info,
              label: info.label || '麦克风-' + i
            })
          }
          if (device.deviceId === 'communications') {
            communicationsDevice = device
          }
          if (device.deviceId === 'default') {
            defaultDevice = device
          }
        }
      })
      if (communicationsDevice) {
        this.currentMicDeviceId = devicesList.find(device => device.groupId === communicationsDevice.groupId).deviceId
      } else if (defaultDevice) {
        this.currentMicDeviceId = devicesList.find(device => device.groupId === defaultDevice.groupId).deviceId
      }
      return devicesList
    })
  }
  /**
   * 清除缓存
   */
  clearCache(force = false) {
    if (force) {
      this.isRecording = false
      this.audioInput = null
      this.isPause = false
    }
    this.duration = 0
    this.audioData = []
    this.audioOffset = 0
  }

  destroy() {
    this.clearCache(true)
    this.stopStream()
    this.transWorker && this.transWorker.terminate()
  }

  /**
   * 终止流（这可以让浏览器上正在录音的标志消失掉）
   */
  stopStream() {
    if (this.stream && this.stream.getTracks) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
  }
}