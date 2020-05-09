/* @flow */

import { _Vue } from '../install'
import type Router from '../index'
import { inBrowser } from '../util/dom'
import { runQueue } from '../util/async'
import { warn, isError, isExtendedError } from '../util/warn'
import { START, isSameRoute } from '../util/route'
import {
  flatten,
  flatMapComponents,
  resolveAsyncComponents
} from '../util/resolve-components'
import { NavigationDuplicated } from './errors'

// 父类
export class History {
  router: Router
  base: string
  current: Route
  pending: ?Route
  cb: (r: Route) => void
  ready: boolean
  readyCbs: Array<Function>
  readyErrorCbs: Array<Function>
  errorCbs: Array<Function>

  // implemented by sub-classes
  // 需要子类(HTML5History、HashHistory)实现的方法
  +go: (n: number) => void
  +push: (loc: RawLocation) => void
  +replace: (loc: RawLocation) => void
  +ensureURL: (push?: boolean) => void
  +getCurrentLocation: () => string

  constructor (router: Router, base: ?string) {
    this.router = router
    // 格式化base，保证base是以/开头
    this.base = normalizeBase(base)
    // start with a route object that stands for "nowhere"
    this.current = START // 当前指向的route对象，默认为START；即from
    this.pending = null // 记录将要跳转的route；即to
    this.ready = false
    this.readyCbs = []
    this.readyErrorCbs = []
    this.errorCbs = []
  }

  // 设置监听器，在updateRoute时回调被调用
  listen (cb: Function) {
    this.cb = cb
  }
  // 注册ready回调
  onReady (cb: Function, errorCb: ?Function) {
    if (this.ready) {
      cb()
    } else {
      this.readyCbs.push(cb)
      if (errorCb) {
        this.readyErrorCbs.push(errorCb)
      }
    }
  }
  // 注册error回调
  onError (errorCb: Function) {
    this.errorCbs.push(errorCb)
  }

  // 路由跳转
  transitionTo (
    location: RawLocation, // 原始location，一个url或者是一个Location interface(自定义形状，在types/router.d.ts中定义)
    onComplete?: Function, // 跳转成功回调
    onAbort?: Function// 跳转失败回调
  ) {
    const route = this.router.match(location, this.current) // 传入需要跳转的location和当前路由对象，返回to的Route
    // 确认跳转
    this.confirmTransition(
      route,
      () => { // onComplete，完成
        this.updateRoute(route) // 更新route，会触发afterEach钩子
        onComplete && onComplete(route) // 调用onComplete回调
        this.ensureURL()

        // fire ready cbs once
        // 触发ready回调
        if (!this.ready) {
          this.ready = true
          this.readyCbs.forEach(cb => {
            cb(route)
          })
        }
      },
      err => { // onAbort，报错（取消）
        if (onAbort) {
          onAbort(err)
        }
        // 触发error回调
        if (err && !this.ready) {
          this.ready = true
          this.readyErrorCbs.forEach(cb => {
            cb(err)
          })
        }
      }
    )
  }
  // 确认路由跳转
  confirmTransition (/* to*/route: Route, onComplete: Function, onAbort?: Function) {
    const current = this.current
    // 取消
    const abort = err => {
      // after merging https://github.com/vuejs/vue-router/pull/2771 we
      // When the user navigates through history through back/forward buttons
      // we do not want to throw the error. We only throw it if directly calling
      // push/replace. That's why it's not included in isError
      if (!isExtendedError(NavigationDuplicated, err) && isError(err)) {
        if (this.errorCbs.length) {
          this.errorCbs.forEach(cb => {
            cb(err)
          })
        } else {
          warn(false, 'uncaught error during route navigation:')
          console.error(err)
        }
      }
      onAbort && onAbort(err)
    }
    // 相同Route，报重复错误
    if (
      isSameRoute(route, current) &&
      // in the case the route map has been dynamically appended to
      // 防止route map 被动态改变了
      route.matched.length === current.matched.length
    ) {
      // ensureURL由子类实现，主要根据传参确定是添加还是替换一个记录
      this.ensureURL() // 替换当前历史记录
      return abort(new NavigationDuplicated(route))
    }
    // 对比前后route的RouteRecord，找出需要更新、失活、激活的的路由记录
    const { updated, deactivated, activated } = resolveQueue(
      this.current.matched,
      route.matched
    )
    // 生成需要执行的守卫、钩子队列
    const queue: Array<?NavigationGuard> = [].concat(
      // in-component leave guards
      extractLeaveGuards(deactivated), // 提取路由组件中所有beforeRouteLeave守卫
      // global before hooks
      this.router.beforeHooks, // 全局的beforeEach钩子
      // in-component update hooks
      extractUpdateHooks(updated), // 提取路由组件中所有beforeRouteUpdate钩子
      // in-config enter guards
      activated.map(m => m.beforeEnter), // 路由独享的beforeEnter守卫
      // async components
      resolveAsyncComponents(activated)// 解析异步组件
    )
    this.pending = route // 记录将要跳转的route，方便取消对比用
    // 迭代函数
    const iterator = (hook: NavigationGuard, next) => {
      if (this.pending !== route) { // 当发现to发生变化，则代表需要取消
        return abort()
      }
      try {
        hook(/* to*/route, /* from*/current, /* next*/(to: any) => {
          if (to === false || isError(to)) {
            // next(false) -> abort navigation, ensure current URL
            // next(false) -> 取消跳转，添加一个新历史记录(但由于url地址未发生变化，所以并未添加记录)
            this.ensureURL(true)
            abort(to)
          } else if (
            typeof to === 'string' || // next('/')
            (typeof to === 'object' &&
              (typeof to.path === 'string' || typeof to.name === 'string')) // next({path:'/'})或next({name:'Home'})
          ) {
            // next('/') or next({ path: '/' }) -> redirect
            abort() // 取消当前
            if (typeof to === 'object' && to.replace) {
              // 调用子类方法的替换记录
              this.replace(to)
            } else {
              // 调用子类方法的添加记录
              this.push(to)
            }
          } else {
            // confirm transition and pass on the value
            // next()
            next(to)
          }
        })
      } catch (e) {
        abort(e)
      }
    }
    // 执行队列
    runQueue(queue, iterator, /* 执行结束回调*/() => {
      const postEnterCbs = [] // 保存beforeRouteEnter中传给next的回调函数
      const isValid = () => this.current === route // 表示跳转结束
      // wait until async components are resolved before
      // extracting in-component enter guards
      const enterGuards = extractEnterGuards(activated, postEnterCbs, isValid) // 等待异步组件解析完，再抽取组件内的beforeRouteEnter守卫
      const queue = enterGuards.concat(this.router.resolveHooks)// beforeResolve hooks
      runQueue(queue, iterator, /* 执行结束回调*/() => {
        if (this.pending !== route) {
          return abort()
        }
        this.pending = null
        onComplete(route) // 执行onComplete回调，onComplete中会调用updateRoute方法，内部会触发afterEach钩子
        if (this.router.app) {
          this.router.app.$nextTick(() => {
            // 调用 beforeRouteEnter 守卫中传给 next 的回调函数
            // next(vm=>xxx)
            postEnterCbs.forEach(cb => {
              cb()
            })
          })
        }
      })
    })
  }
  // 更新路由，触发afterEach钩子
  updateRoute (route: Route) {
    const prev = this.current
    this.current = route// 更新current
    this.cb && this.cb(route) // 调用updateRoute回调
    this.router.afterHooks.forEach(hook => { // 触发afterEach狗子
      hook && hook(/* to*/route, /* from*/prev)
    })
  }
}

// 格式化base，保证base地址是以/开头，尾部无/
function normalizeBase (base: ?string): string {
  if (!base) {
    if (inBrowser) {
      // respect <base> tag
      const baseEl = document.querySelector('base')
      base = (baseEl && baseEl.getAttribute('href')) || '/'
      // strip full URL origin
      base = base.replace(/^https?:\/\/[^\/]+/, '')
    } else {
      base = '/'
    }
  }
  // make sure there's the starting slash
  if (base.charAt(0) !== '/') {
    base = '/' + base
  }
  // remove trailing slash
  return base.replace(/\/$/, '')
}
// 对比curren、next的路由记录列表，找出需要更新、失活、激活的路由记录
function resolveQueue (
  current: Array<RouteRecord>,
  next: Array<RouteRecord>
): {
  updated: Array<RouteRecord>,
  activated: Array<RouteRecord>,
  deactivated: Array<RouteRecord>
} {
  let i
  const max = Math.max(current.length, next.length)
  // 找到首个不相等的路由记录索引
  for (i = 0; i < max; i++) {
    if (current[i] !== next[i]) {
      break
    }
  }
  // eg
  // current:[1,2,3]
  // next:[1,2,3,4,5]
  // i为3
  // 需要更新的为[1,2,3]
  // 需要激活的为[4,5]
  // 需要失活的为[]
  return {
    updated: next.slice(0, i), // 索引左侧是需要更新的
    activated: next.slice(i), // 索引右侧是需要激活的
    deactivated: current.slice(i) // 当前索引右侧是需要失活的
  }
}
// 提取守卫
function extractGuards (
  records: Array<RouteRecord>,
  name: string, // 要提取的守卫名
  bind: Function, // 绑定守卫上下文函数
  reverse?: boolean // 是否需要逆序
): Array<?Function> {
  const guards = flatMapComponents(records, (def, instance, match, key) => {
    const guard = extractGuard(def, name) // 提取出路由组件中的守卫函数
    // 为守卫绑定上下文
    if (guard) {
      return Array.isArray(guard)
        ? guard.map(guard => bind(guard, instance, match, key))
        : bind(guard, instance, match, key)
    }
  })
  // 扁平化 + 逆序
  return flatten(reverse ? guards.reverse() : guards)
}
// 提取单个守卫
function extractGuard (
  def: Object | Function,
  key: string
): NavigationGuard | Array<NavigationGuard> {
  if (typeof def !== 'function') {
    // extend now so that global mixins are applied.
    def = _Vue.extend(def)
  }
  return def.options[key]
}
// 传入路由记录列表，提取出beforeRouteLeave守卫并逆序输出
function extractLeaveGuards (deactivated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(deactivated, 'beforeRouteLeave', bindGuard, true)
}
// 传入路由记录列表，提取出beforeRouteUpdate钩子
function extractUpdateHooks (updated: Array<RouteRecord>): Array<?Function> {
  return extractGuards(updated, 'beforeRouteUpdate', bindGuard)
}
// 将守卫的上下文绑定到vue实例
function bindGuard (guard: NavigationGuard, instance: ?_Vue): ?NavigationGuard {
  if (instance) {
    return function boundRouteGuard () {
      return guard.apply(instance, arguments)
    }
  }
}
// 提取组件的beforeRouteEnter守卫
function extractEnterGuards (
  activated: Array<RouteRecord>,
  cbs: Array<Function>, // postEnterCbs
  isValid: () => boolean
): Array<?Function> {
  return extractGuards(
    activated,
    'beforeRouteEnter',
    (guard, _, match, key) => { /* 绑定beforeRouteEnter的执行上下文 */
      return bindEnterGuard(guard, match, key, cbs, isValid)
    }
  )
}
// 绑定beforeRouteEnter的执行上下文
function bindEnterGuard (
  guard: NavigationGuard,
  match: RouteRecord,
  key: string,
  cbs: Array<Function>, // postEnterCbs
  isValid: () => boolean
): NavigationGuard {
  // 对组件内的beforeRouteEnter进行了包装
  return function routeEnterGuard (to, from, next) {
    // 调用组件内beforeRouteEnter守卫
    return guard(to, from, /* beforeRouteEnter next函数；cb为next中回调*/cb => {
      if (typeof cb === 'function') {
        cbs.push(() => {
          // #750
          // if a router-view is wrapped with an out-in transition,
          // the instance may not have been registered at this time.
          // we will need to poll for registration until current route
          // is no longer valid.
          // 如果router-view被out-in transition包裹
          // 在确认路由，准备调用beforeRouteEnter守卫时，router-view实例可能还不存在
          // 但是此时this.current已经为to
          // 所以必须轮询调用cb直到instance存在
          poll(cb, match.instances, key, isValid)
        })
      }
      // 迭代器下步
      next(cb)
    })
  }
}
// 轮询调用cb
function poll (
  cb: any, /* cb为beforeRouteEnter next中回调*/ // somehow flow cannot infer this is a function
  instances: Object,
  key: string,
  isValid: () => boolean
) {
  if (
    instances[key] &&
    !instances[key]._isBeingDestroyed // do not reuse being destroyed instance
  ) {
    cb(instances[key])
  } else if (isValid()) {
    setTimeout(() => {
      poll(cb, instances, key, isValid)
    }, 16)
  }
}
