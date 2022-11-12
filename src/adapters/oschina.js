const OSC_RESERVED_USER_NAMES = ["explore", "repositories", "popular", "enterprises", "gists", "dashboard", "languages", "search", "links", "invite", "profile", "organizations", "notifications", "login", "signup", "oauth"]
const OSC_RESERVED_REPO_NAMES = ["admin", "dashboard", "groups", "help", "profile", "projects", "search", "codes", "fork_project", "fork_code", "events"]
const OSC_PJAX_CONTAINER_SEL = '#tree-holder'
const OSC_CONTAINERS = '#git-header-nav'
const OSC_EXTENSION_DOM = '.gitee-project-extension'

class Oschina extends PjaxAdapter {
  // @override
  init($sidebar) {
    const pjaxContainer = $(OSC_PJAX_CONTAINER_SEL)[0]
    super.init($sidebar, { 'pjaxContainer': pjaxContainer })

    // Fix #151 by detecting when page layout is updated.
    // In this case, split-diff page has a wider layout, so need to recompute margin.
    // Note that couldn't do this in response to URL change, since new DOM via pjax might not be ready.
    const diffModeObserver = new window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (~mutation.oldValue.indexOf('split-diff') ||
            ~mutation.target.className.indexOf('split-diff')) {
          return $(document).trigger(EVENT.LAYOUT_CHANGE)
        }
      })
    })

    diffModeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
      attributeOldValue: true
    })
  }

  // @override
  getCssClass() {
    return 'octotree_oschina_sidebar'
  }

  // @override
  shouldLoadEntireTree() {
    return true
  }

  // @override
  getCreateTokenUrl() {
    return `https://gitee.com/api/v5/swagger`
  }

  // @override
  updateLayout(togglerVisible, sidebarVisible, sidebarWidth) {
    const SPACING = 232
    const $containers = $(OSC_CONTAINERS)
    const autoMarginLeft = ($(document).width() - $containers.width()) / 2
    const WIDTH = $(document).width() - SPACING
    const shouldPushLeft = sidebarVisible && (autoMarginLeft <= sidebarWidth + SPACING)

    $('html').css('margin-left', shouldPushLeft ? sidebarWidth : '')
    $containers.css('margin-left', shouldPushLeft ? SPACING : '')
    $containers.css('width', shouldPushLeft ? WIDTH : '')
    // $(".ui.right.floated.horizontal.list").css('margin-right', shouldPushLeft ? 210 : '')
    $(".git-project-download-panel").css('margin-right', shouldPushLeft ? 240 : '')
  }

  // @override
  getRepoFromPath(currentRepo, token, cb) {
    const showInNonCodePage = extStore.get(STORE.NONCODE)

    // 检测页面是否存在仓库扩展DOM
    if (!$(OSC_EXTENSION_DOM).length) {
      return cb()
    }

    // (username)/(reponame)[/(type)]
    const match = window.location.pathname.match(/([^\/]+)\/([^\/]+)(?:\/([^\/]+))?/)
    if (!match) {
      return cb()
    }

    const username = match[1]
    const reponame = match[2]

    // Not a repository, skip
    if (~OSC_RESERVED_USER_NAMES.indexOf(username) ||
        ~OSC_RESERVED_REPO_NAMES.indexOf(reponame)) {
      return cb()
    }

    // Skip non-code page unless showInNonCodePage is true
    if (!showInNonCodePage && match[3] && !~['tree', 'blob'].indexOf(match[3])) {
      return cb()
    }

    // Get branch by inspecting page, quite fragile so provide multiple fallbacks
    const branch =
    // Extension value
    this._getExtensionValue('branch') ||
    // Code page
    $('#git-project-branch .text').text().trim() ||
    // Pull requests page
    ($('.commit-ref.base-ref').attr('title') || ':').match(/:(.*)/)[1] ||
    // Reuse last selected branch if exist
    (currentRepo.username === username && currentRepo.reponame === reponame && currentRepo.branch) ||
    // Get default branch from cache
    this._defaultBranch[username + '/' + reponame]

    // Still no luck, get default branch for real
    const repo = { username: username, reponame: reponame, branch: branch }

    if (repo.branch) {
      cb(null, repo)
    } else {
      this._get(null, { repo, token }, (err, data) => {
        if (err) return cb(err)
        repo.branch = this._defaultBranch[username + '/' + reponame] = data.default_branch || 'master'
        cb(null, repo)
      })
    }
  }

  // @override
  selectFile(path) {
    const $pjaxContainer = $(OSC_PJAX_CONTAINER_SEL)
    super.selectFile(path, { '$pjaxContainer': $pjaxContainer, fragment: OSC_PJAX_CONTAINER_SEL })
  }

  // @override
  loadCodeTree(opts, cb) {
    opts.encodedBranch = encodeURIComponent(decodeURIComponent(opts.repo.branch))
    opts.path = (opts.node && (opts.node.sha || opts.encodedBranch)) ||
      (opts.encodedBranch + '?recursive=1')
    this._loadCodeTreeInternal(opts, null, cb)
  }

  // @override
  _getTree(path, opts, cb) {
    this._get(`/git/trees/${path}`, opts, (err, res) => {
      if (err) cb(err)
      else cb(null, res.tree)
    })
  }

  // @override
  _getSubmodules(tree, opts, cb) {
    cb()
  // const item = tree.filter((item) => /^\.gitmodules$/i.test(item.path))[0]
  // if (!item) return cb()
  // this._get(`/git/blobs/${item.sha}`, opts, (err, res) => {
  //     if (err) return cb(err)
  //     const data = atob(res.content.replace(/\n/g, ''))
  //     cb(null, parseGitmodules(data))
  // })
  }

  _get(path, opts, cb) {
    const host = location.protocol + '//' + location.host
    var url = `${host}/api/v5/repos/${opts.repo.username}/${opts.repo.reponame}${path || ''}`
    var request = (retry) => {
      if (!retry && opts.token) {
        url += (url.indexOf("?") >= 0 ? "&" : "?") + `access_token=${opts.token}`
      }
      const cfg = {
        url,
        method: 'GET',
        cache: false,
        xhrFields: {
          withCredentials: true
        },
      }

      $.ajax(cfg)
        .done((data) => {
          if (path && path.indexOf('/git/trees') === 0 && data.truncated) {
            this._handleError({ status: 206 }, cb)
          }
          else cb(null, data)
        })
        .fail((jqXHR) => {
          if (retry) {
            request(false)
          } else {
            this._handleError(jqXHR, cb)
          }
        })
    }
    request(true)
  }

  _getExtensionValue(key) {
    const $extension = $(OSC_EXTENSION_DOM)
    return $extension.find(`.${key}`).text().trim() || ''
  }
}
