import json
import logging
import os
import pwd
import shlex
from pathlib import Path
import configparser

import decky # type: ignore
from settings import SettingsManager # type: ignore
from helpers import get_user # type: ignore


# noinspection PyBroadException
class Plugin:
    _logger: logging.Logger
    _settings: SettingsManager
    _xdg_data_dirs: list[str]
    _home: str

    async def get_apps(self) -> dict[str, dict]:
        apps_settings = self._settings.getSetting("apps", {})

        apps = {}
        for data_dir in self._xdg_data_dirs:
            apps_dir = Path(data_dir, "applications")
            if not apps_dir.is_dir():
                self._logger.debug(f"Skipping non-existent directory: {apps_dir}")
                continue

            for path in apps_dir.rglob("*.desktop"):
                try:
                    config = configparser.ConfigParser(interpolation=None)
                    config.read(path)

                    if config.get("Desktop Entry", "Type", fallback="") != "Application":
                        self._logger.debug(f"Skipping non-application entry: {path}")
                        continue
                    if config.get("Desktop Entry", "NoDisplay", fallback="false") == "true":
                        self._logger.debug(f"Skipping NoDisplay app: {path}")
                        continue
                    if config.get("Desktop Entry", "Hidden", fallback="false") == "true":
                        self._logger.debug(f"Skipping Hidden app: {path}")
                        continue
                    if config.get("Desktop Entry", "Terminal", fallback="false") == "true":
                        self._logger.debug(f"Skipping Terminal app: {path}")
                        continue

                    rel_path = path.relative_to(apps_dir)
                    app_id = "-".join(rel_path.parts[:-1] + (rel_path.stem,))
                    if app_id in apps:
                        self._logger.warning(f"Duplicate entry, skipping: {path}")
                        continue

                    name = config.get("Desktop Entry", "Name", fallback=None)
                    if not name:
                        self._logger.warning(f"Missing Name, skipping: {path}")
                        continue

                    exec_ = shlex.split(config.get("Desktop Entry", "Exec", fallback=""))
                    if not exec_ or not exec_[0]:
                        self._logger.warning(f"Missing Exec, skipping: {path}")
                        continue

                    cmd = []
                    for arg in exec_[1:]:
                        if arg == "%c":
                            cmd.append(name)
                        elif arg == "%k":
                            cmd.append(str(path))
                        elif len(arg) == 2 and arg[0] == "%":
                            continue
                        else:
                            cmd.append(arg)

                    app_settings = apps_settings.get(app_id, {})
                    apps[app_id] = app_settings | {
                        "id": app_id,
                        "name": name,
                        "bin": exec_[0],
                        "cmd": shlex.join(cmd),
                        "workdir": config.get("Desktop Entry", "Path", fallback=self._home),
                        "flatpak": config.has_option("Desktop Entry", "X-Flatpak"),
                    }
                except Exception:
                    self._logger.exception(f"Error reading .desktop file: {path}")

        self._logger.info(f"Found {len(apps)} apps")
        self._logger.debug(f"Apps: {json.dumps(apps, indent=2)}")
        return apps

    async def set_app_setting(self, app_id: str, key: str, data: bool|int|str|None):
        if key not in ["favorite", "hidden", "shortcut", "lastOpened"]:
            raise ValueError(f"Invalid setting key: {key}")

        apps_settings = self._settings.getSetting("apps", {})
        apps_settings.setdefault(app_id, {})[key] = data
        self._settings.setSetting("apps", apps_settings)

    async def get_temporary_shortcuts(self) -> list[int]:
        temporary_shortcuts = self._settings.getSetting("temporaryShortcuts", [])
        if len(temporary_shortcuts) > 0:
            self._logger.warning(f"Found {len(temporary_shortcuts)} temporary shortcuts!")
        return temporary_shortcuts

    async def save_temporary_shortcut(self, app_id: int):
        temporary_shortcuts = self._settings.getSetting("temporaryShortcuts", [])
        if app_id not in temporary_shortcuts:
            temporary_shortcuts.append(app_id)
        self._settings.setSetting("temporaryShortcuts", temporary_shortcuts)

    async def forget_temporary_shortcut(self, app_id: int):
        temporary_shortcuts = self._settings.getSetting("temporaryShortcuts", [])
        if app_id in temporary_shortcuts:
            temporary_shortcuts.remove(app_id)
        self._settings.setSetting("temporaryShortcuts", temporary_shortcuts)

    async def _main(self):
        self._logger = decky.logger
        self._settings = SettingsManager(name="settings", settings_directory=decky.DECKY_PLUGIN_SETTINGS_DIR)

        user = get_user()
        self._home = pwd.getpwnam(user).pw_dir
        self._logger.info(f"Assuming user home directory: {self._home}")

        xdg_data_dirs = os.environ.get("XDG_DATA_DIRS", "").strip()
        xdg_data_dirs = xdg_data_dirs.split(":") if xdg_data_dirs else []

        self._xdg_data_dirs = []
        for dir_ in xdg_data_dirs:
            dir_ = dir_.strip()
            if dir_:
                self._xdg_data_dirs.append(dir_)
        if self._xdg_data_dirs:
            self._logger.info(f"Found XDG_DATA_DIRS in environment: {self._xdg_data_dirs}")

        self._xdg_data_dirs += [
            f"{self._home}/.local/share",
            f"{self._home}/.local/share/flatpak/exports/share",
            "/var/lib/flatpak/exports/share",
            "/usr/local/share",
            "/usr/share",
        ]
        self._xdg_data_dirs = list(dict.fromkeys(self._xdg_data_dirs))
        self._logger.info(f"Using XDG_DATA_DIRS: {self._xdg_data_dirs}")

    async def _unload(self):
        pass
