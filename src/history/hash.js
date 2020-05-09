/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { getLocation } from './html5'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HashHistory extends History {
  constructor (router: Router, base: ?string, fallback: boolean) {
    // 实例化父类
    super(router, base)
    // check history fallback deeplinking
    // fallback只有在指明了mode为history，但是浏览器又不支持popstate，用户手动指明了fallback为true时，才为true，其它情况为false
    // 如果需要回退，则将url换为hash模式(/#开头)
    // this.base来自父类
    if (fallback && checkFallback(this.base)) {
      return
    }
    ensureSlash()
  }

  // this is delayed until the app mounts
  // to avoid the hashchange listener being fired too early
  // 修复#725;https://github.com/vuejs/vue-router/issues/725
  // 因为如果钩子函数 beforeEnter 是异步的话, beforeEnter 钩子就会被触发两次. 因为在初始化时, 如果此时的 hash 值不是以 / 开头的话就会补上 #/, 这个过程会触发 hashchange 事件, 就会再走一次生命周期钩子, 也就意味着会再次调用 beforeEnter 钩子函数.
  setupListeners () {
    const router = this.router
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll
    // 若支持scroll,初始化scroll相关逻辑
    if (supportsScroll) {
      setupScroll()
    }
    // 添加事件监听
    window.addEventListener(
      supportsPushState ? 'popstate' : 'hashchange', // 优先使用popstate
      () => {
        const current = this.current
        if (!ensureSlash()) {
          return
        }
        this.transitionTo(getHash(), route => {
          if (supportsScroll) {
            handleScroll(this.router, /* to*/route, /* from*/current, true)
          }
          // 不支持pushState，直接替换记录
          if (!supportsPushState) {
            replaceHash(route.fullPath)
          }
        })
      }
    )
  }
  // 新增
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        pushHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }
  // 替换
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(
      location,
      route => {
        replaceHash(route.fullPath)
        handleScroll(this.router, route, fromRoute, false)
        onComplete && onComplete(route)
      },
      onAbort
    )
  }
  // 导航
  go (n: number) {
    window.history.go(n)
  }
  // 根据push字段，确定是新增还是替换一条历史记录
  ensureURL (push?: boolean) {
    const current = this.current.fullPath
    if (getHash() !== current) {
      push ? pushHash(current) : replaceHash(current)
    }
  }
  // 获取当前location
  getCurrentLocation () {
    return getHash()
  }
}

/**
 * 检查回退，将url转换为hash模式(添加/#)
 */
function checkFallback (base) {
  const location = getLocation(base)
  // 地址不以/#开头，则添加之
  if (!/^\/#/.test(location)) {
    window.location.replace(cleanPath(base + '/#' + location))
    return true
  }
}

/**
 * 确保url是以/开头
 */
function ensureSlash (): boolean {
  const path = getHash()
  if (path.charAt(0) === '/') {
    return true
  }
  replaceHash('/' + path)
  return false
}

/**
 * 获取#之后内容
 * http://localhost:8080/#/center/test?subjectCode=03&phaseCode=04&hwType=6
 * /center/test?subjectCode=03&phaseCode=04&hwType=6
 */
export function getHash (): string {
  // We can't use window.location.hash here because it's not
  // consistent across browsers - Firefox will pre-decode it!
  let href = window.location.href
  const index = href.indexOf('#')
  // empty path
  if (index < 0) return ''

  href = href.slice(index + 1)
  // decode the hash but not the search or hash
  // as search(query) is already decoded
  // https://github.com/vuejs/vue-router/issues/2708
  // 不decode qs和hash之后的内容
  const searchIndex = href.indexOf('?')
  if (searchIndex < 0) {
    const hashIndex = href.indexOf('#')
    if (hashIndex > -1) {
      href = decodeURI(href.slice(0, hashIndex)) + href.slice(hashIndex)
    } else href = decodeURI(href)
  } else {
    href = decodeURI(href.slice(0, searchIndex)) + href.slice(searchIndex)
  }

  return href
}

function getUrl (path) {
  const href = window.location.href
  const i = href.indexOf('#')
  const base = i >= 0 ? href.slice(0, i) : href
  return `${base}#${path}`
}
// 新增hash记录
function pushHash (path) {
  // 支持pushState，则优先使用pushState
  if (supportsPushState) {
    pushState(getUrl(path))
  } else {
    window.location.hash = path
  }
}
// 替换hash记录
function replaceHash (path) {
  // 支持pushState，则优先使用replaceState
  if (supportsPushState) {
    replaceState(getUrl(path))
  } else {
    window.location.replace(getUrl(path))
  }
}
