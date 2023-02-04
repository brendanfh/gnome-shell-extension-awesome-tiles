/*
 * Copyright (C) 2021 Pim Snel
 * Copyright (C) 2021 Veli Tasalı
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

const ExtensionUtils = imports.misc.extensionUtils
const Gettext = imports.gettext
const Main = imports.ui.main
const { Meta, Shell } = imports.gi

const Me = ExtensionUtils.getCurrentExtension()
const {
  GAP_SIZE_MAX,
  GAP_SIZE_INCREMENTS,
  TILING_STEPS_CENTER,
  TILING_STEPS_SIDE,
  TILING_SUCCESSIVE_TIMEOUT,
} = Me.imports.constants
const { parseTilingSteps } = Me.imports.utils

const Domain = Gettext.domain(Me.metadata.uuid)
const { ngettext } = Domain

const _shortcutsBindingIds = []
const _previousTiledWindows = {}

function init() {
  ExtensionUtils.initTranslations(Me.metadata.uuid)
  return new Extension()
}

class Extension {
  enable() {
    this._settings = ExtensionUtils.getSettings()

    this._bindShortcut("shortcut-align-window-to-center", this._alignWindowToCenter.bind(this))
    this._bindShortcut("shortcut-tile-window-to-center", this._tileWindowCenter.bind(this))
    this._bindShortcut("shortcut-tile-window-to-left", this._tileWindowLeft.bind(this))
    this._bindShortcut("shortcut-tile-window-to-right", this._tileWindowRight.bind(this))
    this._bindShortcut("shortcut-tile-window-to-top", this._tileWindowTop.bind(this))
    this._bindShortcut("shortcut-tile-window-to-top-left", this._tileWindowTopLeft.bind(this))
    this._bindShortcut("shortcut-tile-window-to-top-right", this._tileWindowTopRight.bind(this))
    this._bindShortcut("shortcut-tile-window-to-bottom", this._tileWindowBottom.bind(this))
    this._bindShortcut("shortcut-tile-window-to-bottom-left", this._tileWindowBottomLeft.bind(this))
    this._bindShortcut("shortcut-tile-window-to-bottom-right", this._tileWindowBottomRight.bind(this))
    this._bindShortcut("shortcut-tile-window-restore", this._restoreWindow.bind(this))
    this._bindShortcut("shortcut-increase-gap-size", this._increaseGapSize.bind(this))
    this._bindShortcut("shortcut-decrease-gap-size", this._decreaseGapSize.bind(this))
  }

  disable() {
    this._settings = null
    _shortcutsBindingIds.forEach((id) => Main.wm.removeKeybinding(id))
    _shortcutsBindingIds.length = 0
  }

  _alignWindowToCenter() {
    const window = global.display.get_focus_window()
    if (!window) return

    const windowArea = window.get_frame_rect()
    const monitor = window.get_monitor()
    const workspace = window.get_workspace()
    const workspaceArea = workspace.get_work_area_for_monitor(monitor)

    const x = workspaceArea.x + ((workspaceArea.width - windowArea.width) / 2)
    const y = workspaceArea.y + ((workspaceArea.height - windowArea.height) / 2)

    window.unmaximize(Meta.MaximizeFlags.BOTH)
    window.move_resize_frame(false, x, y, windowArea.width, windowArea.height)
  }

  _bindShortcut(name, callback) {
    const mode = Shell.hasOwnProperty('ActionMode') ? Shell.ActionMode : Shell.KeyBindingMode

    Main.wm.addKeybinding(
      name,
      this._settings,
      Meta.KeyBindingFlags.NONE,
      mode.ALL,
      callback
    )

    _shortcutsBindingIds.push(name)
  }

  _calculateWorkspaceArea(window) {
    const monitor = window.get_monitor()
    const workspace = window.get_workspace()
    const workspaceArea = workspace.get_work_area_for_monitor(monitor)
    const gap = this._gapSize

    if (gap <= 0) return {
      x: workspaceArea.x,
      y: workspaceArea.y,
      height: workspaceArea.height,
      width: workspaceArea.width,
    }

    const gapUncheckedX = Math.round(gap / 200 * workspaceArea.width)
    const gapUncheckedY = Math.round(gap / 200 * workspaceArea.height)

    const gaps = {
      x: Math.min(gapUncheckedX, gapUncheckedY * 2),
      y: Math.min(gapUncheckedY, gapUncheckedX * 2),
    }

    return {
      x: workspaceArea.x + gaps.x,
      y: workspaceArea.y + gaps.y,
      height: workspaceArea.height - (gaps.y * 2),
      width: workspaceArea.width - (gaps.x * 2),
      gaps,
    }
  }

  _decreaseGapSize() {
    this._gapSize = Math.max(this._gapSize - GAP_SIZE_INCREMENTS, 0)
    this._notifyGapSize()
  }

  _increaseGapSize() {
    this._gapSize = Math.min(this._gapSize + GAP_SIZE_INCREMENTS, GAP_SIZE_MAX)
    this._notifyGapSize()
  }

  get _gapSize() {
    return this._settings.get_int("gap-size")
  }

  set _gapSize(intValue) {
    this._settings.set_int("gap-size", intValue)
  }

  _notifyGapSize() {
    const gapSize = this._gapSize
    Main.notify(
      Me.metadata.name,
      ngettext(
        'Gap size is now at %d percent',
        'Gap size is now at %d percent',
        gapSize
      ).format(gapSize)
    )
  }

  get _isInnerGapsEnabled() {
    return this._settings.get_boolean("enable-inner-gaps")
  }

  get _tilingStepsCenter() {
    return parseTilingSteps(
      this._settings.get_string("tiling-steps-center"),
      TILING_STEPS_CENTER,
    )
  }

  get _tilingStepsSide() {
    return parseTilingSteps(
      this._settings.get_string("tiling-steps-side"),
      TILING_STEPS_SIDE,
    )
  }

  _tileWindow(top, bottom, left, right) {
    const window = global.display.get_focus_window()
    if (!window) return

    const time = Date.now()
    const center = !(top || bottom || left || right);
    const prev = this._previousTilingOperation
    const windowId = window.get_id()
    const steps = center ? this._tilingStepsCenter : this._tilingStepsSide
    const successive =
      prev &&
      prev.windowId === windowId &&
      time - prev.time <= TILING_SUCCESSIVE_TIMEOUT &&
      prev.top === top &&
      prev.bottom === bottom &&
      prev.left === left &&
      prev.right === right &&
      prev.iteration < steps.length
    const iteration = successive ? prev.iteration : 0
    const step = 1.0 - steps[iteration]

    const workArea = this._calculateWorkspaceArea(window)
    let { x, y, width, height } = workArea;

    // Special case - when tiling to the center we want the largest size to
    // cover the whole available space
    if (center) {
      width -= Math.round(width * step)
      height -= Math.round(height * step)
      x += Math.round((workArea.width - width) / 2)
      y += Math.round((workArea.height - height) / 2)
    } else {
      if (left !== right) width -= Math.round(width * step)
      if (top !== bottom) height -= Math.round(height * step)
      if (!left) x += (workArea.width - width) / (right ? 1 : 2)
      if (!top) y += (workArea.height - height) / (bottom ? 1 : 2)

      if (this._isInnerGapsEnabled && workArea.gaps !== undefined) {
        if (left !== right) {
          if (right) x += workArea.gaps.x / 2;
          width -= workArea.gaps.x / 2;
        }
        if (top !== bottom) {
          if (bottom) y += workArea.gaps.y / 2;
          height -= workArea.gaps.y / 2;
        }
      }
    }

    if (!(windowId in _previousTiledWindows)) {
        _previousTiledWindows[windowId] = window.get_frame_rect();
    }

    window.unmaximize(Meta.MaximizeFlags.BOTH)
    window.move_resize_frame(false, x, y, width, height)

    this._previousTilingOperation =
      { windowId, top, bottom, left, right, time, iteration: iteration + 1 }
  }

  _tileWindowBottom() {
    this._tileWindow(false, true, true, true)
  }

  _tileWindowBottomLeft() {
    this._tileWindow(false, true, true, false)
  }

  _tileWindowBottomRight() {
    this._tileWindow(false, true, false, true)
  }

  _tileWindowCenter() {
    this._tileWindow(false, false, false, false)
  }

  _tileWindowLeft() {
    this._tileWindow(true, true, true, false)
  }

  _tileWindowRight() {
    this._tileWindow(true, true, false, true)
  }

  _tileWindowTop() {
    this._tileWindow(true, false, true, true)
  }

  _tileWindowTopLeft() {
    this._tileWindow(true, false, true, false)
  }

  _tileWindowTopRight() {
    this._tileWindow(true, false, false, true)
  }

  _restoreWindow() {
    const window = global.display.get_focus_window()
    if (!window) return

    const windowId = window.get_id()

    if (!(windowId in _previousTiledWindows)) return

    let { x, y, width, height } = _previousTiledWindows[windowId]
    window.move_resize_frame(false, x, y, width, height)

    delete _previousTiledWindows[windowId]
  }
}
