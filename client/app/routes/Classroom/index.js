import React from 'react';
import { Button, Pagination, notification, Spin, Tooltip, message } from 'antd';
import { List } from 'immutable';
import { isEqual } from 'lodash';
import axios from 'axios'
import ipcRenderer from 'electron';

import { RoomWhiteboard } from 'white-react-sdk';
import 'white-web-sdk/style/index.css';

import {
  APP_ID
} from '../../agora.config';
import ClassControl from '../../components/ClassControl'
import TitleBar from '../../components/TitleBar';
import WindowPicker from '../../components/WindowPicker';
import SimpleIconButton from '../../components/SimpleIconButton';
import Toolbar from '../../components/Toolbar';
import { localStorage } from '../../utils/storage'
import base64Encode from '../../utils/Base64Encode'
import Whiteboard from '../../utils/Whiteboard';
import './index.scss';

const RECORDING_SERVICE = 'http://123.155.153.85:3233';

notification.config({
  placement: 'bottomLeft'
});

class Classroom extends React.Component {
  constructor(props) {
    super(props);
    this.$client = props.adapter;
    this.$rtc = this.$client.rtcEngine;
    this.subscribeRTCEvents();
    this.state = {
      teacher: '',
      networkQuality: 2,
      isRecording: false,
      recordBtnLoading: false,
      teacherList: List(),
      studentList: List(),
      messageList: List(),
      isSharing: false,
      enableVideo: true,
      enableAudio: true,
      waitSharing: false,
      showWindowPicker: false,
      windowList: [],
      totalPage: 1,
      currentPage: 1
    };
    this.enableChat = true;
  }

  componentDidMount() {
    this.$client.enterClass()
    if (this.$client.user.role === 'teacher') {
      this.$client.prepareScreenShare()
    }
    this.subscribeClientEvents();
    this.subcribeWhiteboardEvents();
  }

  componentWillUnmount() {
    if(this.$client.user.role === 'teacher') {
      this.$client.stopScreenShare()
      this.$client.destroyScreenShare()
    }
  }

  _getOtherStudents = () => {
    let uids = this.state.studentList.map(value => value.uid)
    let index = uids.indexOf(this.$client.user.uid)
    if (index !== -1) {
      return uids.splice(index, 1).toArray();
    } else {
      return uids.toArray();
    }
  }

  subscribeClientEvents = () => {
    this.$client.on('user-added', (uid, info) => {
      if (info.role === 'teacher') {
        // set to high stream
        this.$rtc.setRemoteVideoStreamType(uid, 0)
        this.setState({
          teacherList: this.state.teacherList.push({
            uid,
            username: info.username,
            role: info.role
          }),
          teacher: info.username
        })
      } else if (info.role === 'student') {
        // set to low stream
        this.$rtc.setRemoteVideoStreamType(uid, 1)
        this.setState({
          studentList: this.state.studentList.push({
            uid,
            username: info.username,
            role: info.role,
            video: true,
            audio: true,
            chat: true,
            ring: false
          })
        })
      } else {
        // do nothing in temp
      }
    });
    this.$client.on('user-updated', (uid, preInfo, nextInfo) => {
      if (preInfo.role !== nextInfo.role) {
        if (preInfo.role === 'audience' && nextInfo.role === 'student') {
          if(uid === this.$client.user.uid) {
            this.$rtc.setClientRole(1)
          }
          this.$rtc.setRemoteVideoStreamType(uid, 1)
          this.setState({
            studentList: this.state.studentList.push({
              uid,
              username: nextInfo.username,
              role: nextInfo.role,
              video: true,
              audio: true,
              chat: true,
              ring: false
            })
          })
        }

        if (preInfo.role === 'student' && nextInfo.role === 'audience') {
          if(uid === this.$client.user.uid) {
            this.$rtc.setClientRole(2)
          }
          let index = this.state.studentList.findIndex((value, key) => value.uid === uid);
          if(index !== -1) {
            this.setState({
              studentList: this.state.studentList.splice(index, 1)
            })
          }
        }
      }
    });
    this.$client.on('user-removed', (uid, info) => {
      if (info.role === 'teacher') {
        let index = this.state.teacherList.findIndex((value, key) => value.uid === uid);
        if(index !== -1) {
          this.setState({
            teacherList: this.state.teacherList.splice(index, 1)
          })
        }
      } else if (info.role === 'student') {
        let index = this.state.studentList.findIndex((value, key) => value.uid === uid);
        if(index !== -1) {
          this.setState({
            studentList: this.state.studentList.splice(index, 1)
          })
        };
      } else {
        // do nothing in temp
      }
    });
    this.$client.on('screen-share-started', evt => {
      let board = document.getElementById('shareboard');
      if (board) {
        // reclear board
        board.innerHTML = '';
        // check if presenter is your self
        if(evt.sharerId === this.$client.user.uid) {
          this.$rtc.setupLocalVideoSource(board);
        } else {
          this.$rtc.subscribe(evt.shareId, board);
        }
        // transfer to fit mode
        this.$rtc.setupViewContentMode('videosource', 1);
        this.$rtc.setupViewContentMode(String(evt.shareId), 1);
      };
      this.setState({
        isSharing: true
      });
    })
    this.$client.on('screen-share-stopped', () => {
      let board = document.getElementById('shareboard');
      if(board) {
        board.innerHTML = '';
        this.setState({
          isSharing: false
        });
      };
    })
    this.$client.on('message-received', evt => {
      if (evt.detail.type === 'str') {
        this.setState({
          messageList: this.state.messageList.push({
            content: evt.detail.message,
            username: evt.detail.username,
            local: evt.detail.uid === this.$client.user.uid
          })
        });
      } else {
        // type === 'json'
        let {type, action, uid} = JSON.parse(evt.detail.message);
        let from = evt.detail.uid;
        this.handleRemoteControl(type, action, uid, from);
      }
    });
  }

  subcribeWhiteboardEvents = () => {
    Whiteboard.on('roomStateChanged', modifyState => {
      if (modifyState.globalState) {
        // globalState changed
        let newGlobalState = modifyState.globalState;
        let currentSceneIndex = newGlobalState.currentSceneIndex;
        if ((currentSceneIndex + 1) > this.state.totalPage) {
          this.setState({
            totalPage: currentSceneIndex + 1,
            currentPage: currentSceneIndex + 1
          });
        } else {
          this.setState({
            currentPage: currentSceneIndex + 1
          });
        }
      }
      if (modifyState.memberState) {
        // memberState changed
        // let newMemberState = modifyState.memberState;
        return;
      }
      if (modifyState.broadcastState) {
        // broadcastState changed
        // let broadcastState = modifyState.broadcastState;
        return;
      }
    })
  }

  handleRemoteControl = (type, action, uid, from) => {
    let isLocal = (uid === this.$client.user.uid);
    if (type === 'chat') {
      if(isLocal) {
        this.enableChat = (action === 'enable')
      }
    } else if (type === 'video') {
      if (action === 'enable') {
        if(!isLocal) {
          this.$client.unmuteVideo(uid)
        }
      } else if (action === 'disable') {
        if(!isLocal) {
          this.$client.muteVideo(uid)
        }
      } else if (action === 'enableAll') {
        this.$client.unmuteVideo(this._getOtherStudents()) 
      } else if (action === 'disableAll') {
        this.$client.muteVideo(this._getOtherStudents()) 
      } else {
        throw new Error('Invalid action')
      }
    } else if (type === 'audio') {
      if (action === 'enable') {
        if(!isLocal) {
          this.$client.unmuteAudio(uid)
        }
      } else if (action === 'disable') {
        if(!isLocal) {
          this.$client.muteAudio(uid)
        }
      } else if (action === 'enableAll') {
        this.$client.unmuteAudio(this._getOtherStudents()) 
      } else if (action === 'disableAll') {
        this.$client.muteAudio(this._getOtherStudents()) 
      } else {
        throw new Error('Invalid action')
      }
    } else if (type === 'ring') {
      if(this.$client.user.role === 'teacher') {
        let username = this.$client.getUser(from).username
        message.info(`Student ${username} is ringing the bell!`)
      }
    } else if (type === 'role') {
      if( action === 'requestPromotion') {
        if(this.$client.user.role === 'teacher') {
          let user = this.$client.getUser(from);
          this.openNotification(user.username, user.uid);
        }
      } else {
        // to be extended
      }
    } else {
      // can be extended by your situation
    }
  }

  handleExit = () => {
    this.$client.leaveClass();
    message.info('Left the classroom...');
    window.location.hash = ''
  }

  handleSendMsg = msg => {
    if(this.enableChat) {
      this.$client.broadcastMessage(msg)
    } else {
      message.warn('You are banned to send messages!')
    }
  }

  handleClassCtrlAction = (type, action, uid) => {
    this.$client.broadcastMessage(JSON.stringify({
      type,
      action,
      uid
    }), 'json');
    let index = this.state.studentList.findIndex((value, key) => value.uid === uid);
    if(index !== -1) {
      this.setState({
        studentList: this.state.studentList.update(index, value => {
          value[type] = !value[type];
          return value
        })
      });
    }
  }

  subscribeRTCEvents = () => {
    this.$rtc.on('error', (err, msg) => {
      console.error(`RtcEngine throw an error: ${err}`);
    });
    this.$rtc.on('lastmilequality', (quality) => {
      this.setState({
        networkQuality: quality
      });
    });
  }

  onChangePage = (value) => {
    const { room } = Whiteboard;
    this.setState({
      currentPage: value
    });
    room.setGlobalState({
      currentSceneIndex: value - 1,
    });
  }

  handleAddingPage = () => {
    const { room } = Whiteboard;
    const newPageIndex = this.state.totalPage + 1;
    const newTotalPage = this.state.totalPage + 1;
    this.setState({
      currentPage: newPageIndex,
      totalPage: newTotalPage
    });
    room.insertNewPage(newPageIndex - 1);
    room.setGlobalState({
      currentSceneIndex: newPageIndex - 1,
    });
  }

  handleShareScreen = () => {
    if (!this.state.isSharing) {
      let list = this.$rtc.getScreenWindowsInfo();
      let windowList = list.map(item => {
        return {
          ownerName: item.ownerName,
          name: item.name,
          windowId: item.windowId,
          image: base64Encode(item.image)
        }
      })
      this.setState({
        showWindowPicker: true,
        windowList: windowList
      });
      return;
      // this.$client.startScreenShare();
    } 
    this.$client.stopScreenShare();
    this.setState({
      waitSharing: true,
      isSharing: !this.state.isSharing
    })
    setTimeout(() => {
      this.setState({
        waitSharing: false
      })
    }, 300)
  }

  handleWindowPicker = windowId => {
    this.$client.startScreenShare(windowId);
    this.setState({
      waitSharing: true,
      showWindowPicker: false,
      isSharing: !this.state.isSharing
    });
    setTimeout(() => {
      this.setState({
        waitSharing: false
      })
    }, 300);
  }

  openNotification = (username, uid) => {
    const key = `open${Date.now()}`;
    const handleBtnClick = () => {
      this.handlePromotion(uid);
      notification.close(key);
    }
    const btn = (
      <Button type="primary" size="small" onClick={handleBtnClick}>
        Confirm
      </Button>
    );

    notification.open({
      message: 'Request for promotion',
      description: `Audience ${username} wants to join the discussion`,
      btn,
      key
    });
  };


  handleStartRecording = () => {
    console.log('Start Recording...');
    this.setState({
      recordBtnLoading: true
    });
    axios.post(`${RECORDING_SERVICE}/v1/recording/start`, {
      appid: APP_ID,
      channel: this.$client.channel,
      uid: this.$client.user.uid
    }).then(res => {
      this.setState({
        recordBtnLoading: false,
        isRecording: true
      });
    }).catch(err => {
      console.error(err);
      this.setState({
        recordBtnLoading: false
      });
    });
  }

  handleStopRecording = () => {
    console.log('Stop Recording...');
    this.setState({
      recordBtnLoading: true
    });
    axios.post(`${RECORDING_SERVICE}/v1/recording/stop`, {
      appid: APP_ID,
      channel: this.$client.channel,
      uid: this.$client.user.uid
    }).then(res => {
      this.setState({
        recordBtnLoading: false,
        isRecording: false
      });
    }).catch(err => {
      console.error(err);
      this.setState({
        recordBtnLoading: false
      });
    });
  }

  handleToggleVideo = () => {
    this.setState({
      enableVideo: !this.state.enableVideo
    }, () => {
      if (this.state.enableVideo) {
        this.$client.unmuteVideo()
      } else {
        this.$client.muteVideo()
      }
    })
  }

  handleToggleAudio = () => {
    this.setState({
      enableAudio: !this.state.enableAudio
    }, () => {
      if(this.state.enableAudio) {
        this.$client.unmuteAudio()
      } else {
        this.$client.muteAudio()
      }
    })
  }

  handleRing = () => {
    this.$client.broadcastMessage(JSON.stringify({
      type: 'ring'
    }), 'json')
  }

  handleRequestPromotion = () => {
    this.$client.broadcastMessage(JSON.stringify({
      type: 'role',
      action: 'requestPromotion',
    }), 'json')
  }

  handlePromotion = uid => {
    this.$client.updateUserInfo(uid, {
      role: 'student'
    });
  }

  handleDemotion = uid => {
    this.$client.updateUserInfo(uid, {
      role: 'audience'
    });
  }

  render() {
    // get network status
    const profile = {
      0: {
        text: 'unknown', color: '#000', bgColor: '#FFF'
      },
      1: {
        text: 'excellent', color: '', bgColor: ''
      },
      2: {
        text: 'good', color: '#7ED321', bgColor: '#B8E986'
      },
      3: {
        text: 'poor', color: '#F5A623', bgColor: '#F8E71C'
      },
      4: {
        text: 'bad', color: '#FF4D89', bgColor: '#FF9EBF'
      },
      5: {
        text: 'vbad', color: '', bgColor: ''
      },
      6: {
        text: 'down', color: '#4A90E2', bgColor: '#86D9E9'
      }
    };

    const quality = (() => {
      switch (this.state.networkQuality) {
        default:
        case 0:
          return profile[0];
        case 1:
        case 2:
          return profile[2];
        case 3:
          return profile[3];
        case 4:
        case 5:
          return profile[4];
        case 6:
          return profile[6];
      }
    })();

    const teacher = (() => {
      let result = []
      this.state.teacherList.map(item => {
        result.push((
          <Window 
            key={item.uid} 
            uid={item.uid}
            isLocal={item.uid === this.$client.user.uid}
            adapter={this.props.adapter}
            username={item.username} 
            role={item.role} />
        ))
      })
      return result
    })();

    const students = (() => {
      let result = []
      this.state.studentList.map(item => {
        result.push((
          <Window 
            onDoubleClick={_ => {
              console.log('dbl test' ,this.$rtc.setRemoteVideoStreamType(item.uid, 0))
            }}
            key={item.uid} 
            uid={item.uid}
            isLocal={item.uid === this.$client.user.uid}
            adapter={this.props.adapter}
            username={item.username} 
            role={item.role} />
        ))
      })
      return result
    })();

    // recording Button
    let RecordingButton;
    if (this.$client.user.role === 'teacher') {
      let id,
        content,
        func;
      if (this.state.isRecording) {
        id = 'recordBtn disabled';
        content = 'Stop Recording';
        func = this.handleStopRecording;
      } else {
        id = 'recordBtn';
        content = 'Start Recording';
        func = this.handleStartRecording;
      }
      RecordingButton = (
        <Button className="no-drag-btn" loading={this.state.recordBtnLoading} onClick={func} id={id} type="primary">{content}</Button>
      );
    }

    // Toolbar
    let ButtonGroup= [];

    if (this.$client.user.role === 'audience') {
      ButtonGroup = [
        (
          <SimpleIconButton style={{marginBottom: '6px'}} key={0} onClick={this.handleRequestPromotion} type="promote" />
        )
      ]
    } else {
      ButtonGroup = [
        (
          <SimpleIconButton style={{marginBottom: '6px'}} key={0} active={this.state.enableVideo} onClick={this.handleToggleVideo} type="video" />
        ),
        (
          <SimpleIconButton style={{marginBottom: '6px'}} key={1} active={this.state.enableAudio} onClick={this.handleToggleAudio} type="audio" />
        )
      ]
    }

    if (this.$client.user.role === 'student') {
      ButtonGroup.push((<SimpleIconButton style={{marginBottom: '6px'}} key={2} onClick={this.handleRing} type="hand-up" />));
    }

    const { room } = Whiteboard;

    let windowPicker;
    if (this.state.showWindowPicker) {
      windowPicker = <WindowPicker
        onSubmit={this.handleWindowPicker}
        onCancel={e => this.setState({showWindowPicker: false})}
        windowList={this.state.windowList}
      />
    }

    let shareBtnState = this.state.isSharing ? 'sharing' : 'default';
    if (this.state.waitSharing) {
      shareBtnState = 'preparing';
    }

    return (
      <div className="wrapper" id="classroom">
        <header className="title">
          <div className="status-bar">
            <Tooltip title={`Network Status: ${quality.text}`}>
              <span>Network Status: {quality.text}</span>
            </Tooltip>
            <Tooltip title={`Classroom: ${this.$client.channel}`}>
              <span>Classroom: {this.$client.channel}</span>
            </Tooltip>
            <Tooltip title={
              `Teacher: ${this.state.teacher}`
            }>
              <span>
                Teacher: {
                  this.state.teacher
                }
              </span>
            </Tooltip>
          </div>

          <TitleBar>
            {RecordingButton}
            <Button className="no-drag-btn btn" ghost icon="logout" onClick={this.handleExit} />
          </TitleBar>

        </header>
        <section className="students-container">{students}</section>
        <section className="board-container">
          <div className="board" id="whiteboard" style={{ display: this.state.isSharing ? 'none' : 'block' }}>
            { 
              Whiteboard.readyState === false ? (
              <div className="board-mask">
                <span>Something wrong with Whiteboard service</span>
              </div>
              )
              : (
                <React.Fragment>
                  <div style={{display: this.$client.user.role === 'audience'?'flex':'none'}} className="board-mask"></div>
                  <RoomWhiteboard room={room} style={{ width: '100%', height: '100vh' }} />
                  <div className="pagination">
                    <Pagination 
                      defaultCurrent={1}
                      current={this.state.currentPage}
                      total={this.state.totalPage}
                      pageSize={1}
                      onChange={this.onChangePage}
                    />
                  </div>
                </React.Fragment>
              )
            }
          
          </div>
          <div className="board" id="shareboard" />
          {
            this.$client.user.role === 'audience' ? '' 
            : <React.Fragment>
              <Toolbar
                whiteboard={Whiteboard.readyState}
                enableShareScreen={this.$client.user.role === 'teacher'}
                shareBtnState={shareBtnState}
                handleShareScreen={this.handleShareScreen}
                handleAddingPage={this.handleAddingPage}
              />
              { windowPicker }
            </React.Fragment>
          }

          <div className="float-button-group">
            { ButtonGroup }
          </div>
        </section>
        <section className="teacher-container">
          {teacher}
        </section>

        <ClassControl
          className="channel-container"
          controllable={this.$client.user.username === this.state.teacher}
          onSendMessage={this.handleSendMsg} 
          onAction={this.handleClassCtrlAction}
          messages={this.state.messageList.toArray()} 
          users={this.state.studentList.toArray()} 
        />

      </div>
    );
  }
}

class Window extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true
    };
    this.$rtc = props.adapter.rtcEngine
  }

  shouldComponentUpdate(nextProps, nextState) {
    // always return false in temp
    if(this.state.loading = nextState.loading) {
      return false
    }
    return true
  }

  componentDidMount() {
    const dom = document.querySelector(`#video-${this.props.uid}`);
    if (this.props.isLocal) {
      // local stream
      console.log(`Setup local: ${this.props.uid}`);
      this.$rtc.setupLocalVideo(dom);
    } else {
      // remote stream
      console.log(`Setup remote: ${this.props.uid}`);
      this.$rtc.subscribe(this.props.uid, dom);
    }

    let name = this.props.uid;
    name = this.props.isLocal ? 'local' : name;

    const render = this.$rtc.streams[name];
    if (render) {
      if (render.firstFrameRender) {
        this.setState({ loading: false });
      } else {
        render.event.on('ready', () => {
          this.setState({ loading: false });
        });
      }
    }
  }

  render() {
    const loaderClass = this.state.loading ? 'loader loading' : 'loader';
    if (this.props.role === 'teacher') {
      return (
        <div className="teacher-window">
          <div className="teacher-video" id={`video-${this.props.uid}`}>
            <Spin className={loaderClass} />
          </div>
          <div className="teacher-bar">Teacher: {this.props.username}</div>
        </div>
      );
    } else if (this.props.role === 'student') {
      return (
        <div onDoubleClick={this.props.onDoubleClick} className="student-window">
          <div className="student-video" id={`video-${this.props.uid}`}>
            <Spin className={loaderClass} />
          </div>
          <div className="student-bar">{this.props.username}</div>
        </div>
      );
    }
  }
}

export default Classroom;
