/* @flow */

import type Router from '../index'
import { History } from './base'
import { cleanPath } from '../util/path'
import { START } from '../util/route'
import { setupScroll, handleScroll } from '../util/scroll'
import { pushState, replaceState, supportsPushState } from '../util/push-state'

export class HTML5History extends History {
  constructor (router: Router, base: ?string) {
    // 初始化父类History
    super(router, base)

    // 检测是否需要支持scroll
    const expectScroll = router.options.scrollBehavior
    const supportsScroll = supportsPushState && expectScroll

    // 若支持scroll,初始化scroll相关逻辑
    if (supportsScroll) {
      setupScroll()
    }

    // 获取初始location
    const initLocation = getLocation(this.base)
    // 监听popstate事件
    window.addEventListener('popstate', e => {
      const current = this.current

      // Avoiding first `popstate` event dispatched in some browsers but first
      // history route not updated since async guard at the same time.
      // 某些浏览器，会在打开页面时触发一次popstate
      // 此时如果初始路由是异步路由,就会出现`popstate`先触发,初始路由后解析完成，进而导致route未更新
      // 所以需要避免
      const location = getLocation(this.base)
      if (this.current === START && location === initLocation) {
        return
      }

      // 路由地址发生变化，则跳转，并在跳转后处理滚动
      this.transitionTo(location, route => {
        if (supportsScroll) {
          handleScroll(router, route, current, true)
        }
      })
    })
  }
  // 导航
  go (n: number) {
    window.history.go(n)
  }
  // 新增
  push (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(location, route => {
      pushState(cleanPath(this.base + route.fullPath))
      handleScroll(this.router, route, fromRoute, false)
      onComplete && onComplete(route)
    }, onAbort)
  }
  // 替换
  replace (location: RawLocation, onComplete?: Function, onAbort?: Function) {
    const { current: fromRoute } = this
    this.transitionTo(location, route => {
      replaceState(cleanPath(this.base + route.fullPath))
      handleScroll(this.router, route, fromRoute, false)
      onComplete && onComplete(route)
    }, onAbort)
  }
  // 根据push参数，确定是push还是replace一个记录
  ensureURL (push?: boolean) {
    if (getLocation(this.base) !== this.current.fullPath) {
      const current = cleanPath(this.base + this.current.fullPath)
      push ? pushState(current) : replaceState(current)
    }
  }

  // 获取当前location
  getCurrentLocation (): string {
    return getLocation(this.base)
  }
}

// 获取base之后的url
// https://router.vuejs.org/zh/api/#routes
// 假如base为/zh/
// 则返回api/#routes
export function getLocation (base: string): string {
  let path = decodeURI(window.location.pathname)
  if (base && path.indexOf(base) === 0) {
    path = path.slice(base.length)
  }
  return (path || '/') + window.location.search + window.location.hash
}
