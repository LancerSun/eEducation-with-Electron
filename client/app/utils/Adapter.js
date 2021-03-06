/**

 */
import AgoraRtcEngine from 'agora-electron-sdk';
import DataProvider from './ExampleDataProvider';
import EventEmitter from 'events';

/**
 * Default screen-share stream's id
 * @constant SHARE_ID 
 */
const SHARE_ID = 2

/**
 * A class representing Adapter.
 * Adapter is not another sdk, but a flexible, light-weight 
 * encapsulation for Agora Electron sdk for E-edu,
 * easier to use and extend.
 * @class Adapter 
 */
export default class Adapter extends EventEmitter {
  /**
   * Encapsulation regular profile you need to set
   * @param {boolean} audience if user is an audience
   * @param {number} videoProfile videoProfile 
   * @param {boolean} swapWidthAndHeight if swap width and height
   */
  initProfile(audience = false, videoProfile = 43, swapWidthAndHeight = false) {
    let rtcEngine = this.rtcEngine
    rtcEngine.setChannelProfile(1)
    rtcEngine.setClientRole((audience ? 2 : 1));
    rtcEngine.setAudioProfile(0, 1);
    rtcEngine.enableWebSdkInteroperability(true)
    rtcEngine.setParameters('{"che.audio.live_for_comm":true}');
    rtcEngine.setParameters('{"che.audio.enable.agc":false}');
    rtcEngine.setParameters('{"che.video.moreFecSchemeEnable":true}');
    rtcEngine.setParameters('{"che.video.lowBitRateStreamParameter":{"width":192,"height":108,"frameRate":15,"bitRate":100}}');
    if(!audience) {
      // audience do not publish stream
      rtcEngine.enableDualStreamMode(true);
      rtcEngine.enableVideo();
      rtcEngine.enableLocalVideo(true);
      rtcEngine.setVideoProfile(videoProfile, swapWidthAndHeight);
    }
  }

  /**
   * connect to server and init class through data provider
   * @param {string} appId Agora App ID
   * @param {string} channel channel name
   * @param {Object} user username, role, uid
   */
  initClass(appId, channel, user = {uid, username, role}) {
    return new Promise((resolve, reject) => {
      if(!appId) {
        reject(new Error('appId cannot be empty!'));
      }
      // init local user info
      if(!user.uid) {
        // if no uid, use ts instead
        user.uid = Number(String(new Date().getTime()).slice(7));
      }
      this.user = user;
      this.channel = channel;
      this.appId = appId;
      // init rtc engine
      this.rtcEngine = new AgoraRtcEngine();
      this.rtcEngine.initialize(appId);
      console.log('Agora RTC Engine: ', this.rtcEngine.getVersion());
      // init data provider
      this.dataProvider = new DataProvider();
      // init userlist
      this.userList = {};
      // subscribe data provider event
      this.subDataProviderEvents();
      // do connect
      this.dataProvider.connect(appId, channel).then(() => {
        // dispatch action
        this.dataProvider.dispatch('initClass', {appId, channel, user}).then(() => {
          resolve({uid: user.uid});
        }).catch(err => {
          reject(err);
        });
      }).catch(err => {
        reject(err);
      });
    })
  }

  /**
   * actually join media channel to make stream ready
   * @param {string} token - token calculated by app id & app cert
   * @param {string} info - extra info to be broadcast when joinned channel
   */
  enterClass(token = null, info = '') {
    this.subRtcEvents()
    this.rtcEngine.joinChannel(token, this.channel, info, this.user.uid);
  }

  /**
   * leave the media channel
   */
  leaveClass() {
    this.rtcEngine.leaveChannel();
    this.removeAllListeners();
    this.dataProvider.dispatch('leaveClass', {user: this.user});
    this.dataProvider.disconnect()
  }

  /**
   * prepare screen share: initialize and join
   * @param {string} token 
   * @param {string} info 
   * @param {number} timeout 
   */
  prepareScreenShare(token = null, info = '', timeout = 30000) {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        reject(new Error('Timeout'))
      }, timeout)
      this.rtcEngine.once('videosourcejoinedsuccess', uid => {
        clearTimeout(timer)
        this.sharingPrepared = true
        resolve(uid)
      });
      try {
        this.rtcEngine.videoSourceInitialize(this.appId);
        this.rtcEngine.videoSourceSetChannelProfile(1);
        this.rtcEngine.videoSourceEnableWebSdkInteroperability(true)
        this.rtcEngine.videoSourceSetVideoProfile(50, false);
        // to adjust render dimension to optimize performance
        this.rtcEngine.setVideoRenderDimension(3, SHARE_ID, 1600, 900);
        this.rtcEngine.videoSourceJoin(token, this.channel, info, SHARE_ID);
      } catch(err) {
        clearTimeout(timer)
        reject(err)
      }
    })
  }

  /**
   * when you no longer need to do screen sharing, release it
   */
  destroyScreenShare() {
    this.rtcEngine.videoSourceLeave();
    this.rtcEngine.videoSourceRelease();
  }

  /**
   * start screen share
   */
  startScreenShare() {
    if(!this.sharingPrepared) {
      console.error('Sharing not prepared yet.')
      return false
    };
    return new Promise((resolve, reject) => {
      this.rtcEngine.startScreenCapture2(0, 15, {
        top: 0, left: 0, right: 0, bottom: 0
      }, 0);
      this.rtcEngine.startScreenCapturePreview();
      this.dataProvider.dispatch('startScreenShare', {
        shareId: SHARE_ID,
        sharerId: this.user.uid
      }).then(() => {
        resolve({
          shareId: SHARE_ID,
          sharerId: this.user.uid
        })
      }).catch(err => {
        reject(err)
      });
    });
  }

  /**
   * stop screen share
   */
  stopScreenShare() {
    return new Promise((resolve, reject) => {
      this.dataProvider.dispatch('stopScreenShare', {
        shareId: SHARE_ID,
        sharerId: this.user.uid
      }).then(() => {
        this.rtcEngine.stopScreenCapture2();
        this.rtcEngine.stopScreenCapturePreview();
        resolve({
          shareId: SHARE_ID,
          sharerId: this.user.uid
        })
      }).catch(err => {
        reject(err)
      })
    })
  }

  /**
   * uid is undefined => mute self
   * uid is number => mute target uid
   * uid is Array => mute target uids
   * @param {number|number[]} uids 
   */
  muteVideo(uids) {
    if (uids === undefined) {
      return this.rtcEngine.muteLocalVideoStream(true)
    }
    if(typeof(uids) === 'number') {
      if(uids === this.user.uid) {
        return this.rtcEngine.muteLocalVideoStream(true)
      } else {
        return this.rtcEngine.muteRemoteVideoStream(uids, true)
      }
    }
    if(uids instanceof Array) {
      for(let uid of uids) {
        let result = this.rtcEngine.muteRemoteVideoStream(uid, true);
        if (result !== 0 ) {
          return result;
        }
      }
    }
  }

  /**
   * uid is undefined => unmute self
   * uid is number => unmute target uid
   * uid is Array => unmute target uids
   * @param {number|number[]} uids 
   */
  unmuteVideo(uids) {
    if (uids === undefined) {
      return this.rtcEngine.muteLocalVideoStream(false)
    }
    if(typeof(uids) === 'number') {
      if(uids === this.user.uid) {
        return this.rtcEngine.muteLocalVideoStream(false)
      } else {
        return this.rtcEngine.muteRemoteVideoStream(uids, false)
      }
    }
    if(uids instanceof Array) {
      for(let uid of uids) {
        let result = this.rtcEngine.muteRemoteVideoStream(uid, false);
        if (result !== 0) {
          return result;
        }
      }
    }
  }

  /**
   * uid is undefined => mute self
   * uid is number => mute target uid
   * uid is Array => mute target uids
   * @param {number|number[]} uids 
   */
  muteAudio(uids) {
    if (uids === undefined) {
      return this.rtcEngine.muteLocalAudioStream(true)
    }
    if(typeof(uids) === 'number') {
      if(uids === this.user.uid) {
        return this.rtcEngine.muteLocalAudioStream(true)
      } else {
        return this.rtcEngine.muteRemoteAudioStream(uids, true)
      }
    }
    if(uids instanceof Array) {
      for(let uid of uids) {
        let result = this.rtcEngine.muteRemoteAudioStream(uid, true);
        if (result !== 0) {
          return result;
        }
      }
    }
  }

  /**
   * uid is undefined => unmute self
   * uid is number => unmute target uid
   * uid is Array => unmute target uids
   * @param {number|number[]} uids 
   */
  unmuteAudio(uids) {
    if (uids === undefined) {
      return this.rtcEngine.muteLocalAudioStream(false)
    }
    if(typeof(uids) === 'number') {
      if(uids === this.user.uid) {
        return this.rtcEngine.muteLocalAudioStream(false)
      } else {
        return this.rtcEngine.muteRemoteAudioStream(uids, false)
      }
    }
    if(uids instanceof Array) {
      for(let uid of uids) {
        let result = this.rtcEngine.muteRemoteAudioStream(uid, false);
        if (result !== 0) {
          return result;
        }
      }
    }
  }

  /**
   * broadcast message in channel
   * @param {string} message 
   * @param {string} type - whether a 'str' or a 'json'
   */
  broadcastMessage(message = '', type = 'str') {
    if(!message) {
      return
    }
    this.dataProvider.dispatch('broadcastMessage', {
      message, 
      user: this.user, 
      type
    })
  }

  /**
   * get user by uid from userlist
   * @param {number} uid uid
   * @return {Object} User with username, role and uid
   */
  getUser(uid) {
    if(this.userList.hasOwnProperty(uid)) {
      let temp = this.userList[uid]
      return {
        username: temp.info && temp.info.username,
        role: temp.info && temp.info.role,
        uid: uid
      }
    } else {
      return false
    }
  }

  /**
   * @private
   * new a object only when both info and stream are set will callback be emit
   * @param {number} uid 
   * @param {function} callback 
   */
  newUser(uid, callback) {
    let target = {
      uid,
      hasInfo: false,
      hasStream: false
    }
    Object.defineProperties(target, {
      info: {
        set: function (val) {
          this.accessInfo = val
          if (val) {
            this.hasInfo = true
            if (val.role === 'audience') {
              callback(this.uid, this.info, this.stream)
            }
            if (this.hasStream) {
              callback(this.uid, this.info, this.stream)
            }
          }
        },
        get: function () {
          return this.accessInfo
        }
      },
      stream: {
        set: function (val) {
          this.accessStream = val
          if (val) {
            this.hasStream = true
            if (this.hasInfo) {
              callback(this.uid, this.info, this.stream)
            }
          }
        },
        get: function () {
          return this.accessStream
        }
      }
    })
    return target
  }

  /**
   * @private
   * callback for user info and stream both ready
   */
  handleUserAdded = (uid, info, stream) => {
    if (info.role === 'teacher') {
      this.rtcEngine.setRemoteVideoStreamType(uid, 0)
      this.emit('teacher-added', uid, info, stream)
    } else if (info.role === 'student') {
      this.rtcEngine.setRemoteVideoStreamType(uid, 1)
      this.emit('student-added', uid, info, stream)
    } else if (info.role === 'audience') {
      this.emit('audience-added', uid, info, stream)
    } else {
      console.warn('Unknow role for user: ' + uid)
    }
  }

  /**
   * @private
   * add user to userlist
   * @param {number} uid 
   * @param {object} info 
   * @param {object} stream 
   */
  addUser = (uid, info, stream) => {
    // if not exist, create one
    if (!this.userList.hasOwnProperty(uid)) {
      this.userList[uid] = this.newUser(uid, this.handleUserAdded)
    }
    let target = this.userList[uid]
    if (info && !target.info) {
      target.info = info
    }
    if (stream && !target.stream) {
      target.stream = stream
    }
  }

  /**
   * @private
   * remove user from userList and trigger related event
   * @param {number} uid 
   */
  removeUser(uid) {
    if(this.userList.hasOwnProperty(uid)) {
      let info = this.userList[uid].info;
      let role = info && info.role
      delete this.userList[uid]
      if(role === 'teacher') {
        this.emit('teacher-removed', uid)
      } else if(role === 'student') {
        this.emit('student-removed', uid)
      } else if (role === 'audience') {
        this.emit('audience-removed', uid)
      } else {
        console.warn('Unknow role for user: ' + uid)
      }
    }
  }

  /**
   * @private
   * subscribe rtc engine events
   */
  subRtcEvents() {
    this.rtcEngine.on('removestream', (uid, reason) => {
      let user = this.getUser(uid)
      this.dataProvider.dispatch('leaveClass', {user})
      this.removeUser(uid)
    });
    this.rtcEngine.on('userjoined', (uid, elpased) => {
      // add stream info for a user
      this.addUser(uid, null, uid)
    });
    this.rtcEngine.on('joinedchannel', (channel, uid, elpased) => {
      this.addUser(uid, null, uid);
      this._joinned = true;
      if(this.sharingInfo) {
        this.emit('screen-share-started', {
          sharerId: this.sharingInfo.sharerId, 
          shareId: this.sharingInfo.shareId
        })
      };
    });
    this.rtcEngine.on('rejoinedchannel', (channel, uid, elpased) => {
      this.addUser(uid, null, uid);
      this._joinned = true;
      if(this.sharingInfo) {
        this.emit('screen-share-started', {
          sharerId: this.sharingInfo.sharerId, 
          shareId: this.sharingInfo.shareId
        })
      };
    });
    this.rtcEngine.on('error', (err, message) => {
      console.error(err, message)
    });
    this.rtcEngine.on('leavechannel', () => {
      this._joinned = false;
    })
  }

  /**
   * @private
   * subscribe event of data provider
   */
  subDataProviderEvents() {
    this.dataProvider.on('user-info-removed', ({uid}) => {
      this.removeUser(uid)
    });
    this.dataProvider.on('user-info-updated', ({uid, info}) => {
      this.addUser(uid, info, null)
    });
    this.dataProvider.on('screen-share-started', ({sharerId, shareId}) => {
      if (this._joinned) {
        this.emit('screen-share-started', {sharerId, shareId})
      } else {
        this.sharingInfo = {
          shareId: shareId,
          sharerId: sharerId
        }
      }
    });
    this.dataProvider.on('screen-share-stopped', () => {
      this.sharingInfo = null
      this.emit('screen-share-stopped')
    });
    this.dataProvider.on('message-received', ({id, detail = {
      message, ts, uid, username, role, type
    }}) => {
      this.emit('message-received', {id, detail})
    });
  }

}