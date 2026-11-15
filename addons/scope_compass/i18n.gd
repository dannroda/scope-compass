@tool
extends RefCounted
## Idioma del dock (spec §45, D56). El texto fuente es el castellano del código y es la clave: I18n.t("Hub en %s")
## devuelve el inglés de i18n/en.po (que Godot carga solo como Translation, sin tocar el TranslationServer del editor)
## o el mismo texto. Se formatea después de traducir: I18n.t("Hub en %s") % url.
##
## El idioma: SCOMPASS_LANG; si no, el ajuste del editor scope_compass/language (Auto, English, Español); si no, el
## idioma del editor (fuera del editor, el del sistema). Se elige al cargar el addon: cambiarlo vale al reabrir el
## editor. Sin class_name, para no chocar con una clase del juego: los scripts lo cargan con preload("i18n.gd").

const SETTING := "scope_compass/language"
## Opciones del ajuste, en el orden del enum.
const SETTING_HINT := "Auto,English,Español"
const CATALOG := preload("i18n/en.po")

static var _lang := ""


## 'es' o 'en': el idioma de los textos del dock y el que se le pide al hub (Accept-Language).
static func lang() -> String:
	if _lang == "":
		_lang = _detect()
	return _lang


## Para los tests: vuelve a detectar el idioma (o fija uno).
static func reset(forced := "") -> void:
	_lang = _norm(forced)


static func t(text: String) -> String:
	if lang() != "en":
		return text
	var out := String((CATALOG as Translation).get_message(text))
	return out if out != "" else text


## es* → es; vacío, C o POSIX → ""; otro idioma → en.
static func _norm(code: String) -> String:
	var c := code.strip_edges().to_lower()
	if c == "" or c == "c" or c == "posix" or c == "auto":
		return ""
	return "es" if c.begins_with("es") else "en"


static func _detect() -> String:
	var env := _norm(OS.get_environment("SCOMPASS_LANG"))
	if env != "":
		return env
	if Engine.is_editor_hint():
		var es := EditorInterface.get_editor_settings()
		if es:
			var chosen := int(es.get_setting(SETTING)) if es.has_setting(SETTING) else 0
			if chosen == 1:
				return "en"
			if chosen == 2:
				return "es"
			var editor := _norm(str(es.get_setting("interface/editor/editor_language")))
			return editor if editor != "" else "en"
	var sys := _norm(OS.get_locale())
	return sys if sys != "" else "en"


## Registra el ajuste en Editor Settings (lo llama el plugin al habilitarse).
static func register_setting(es: EditorSettings) -> void:
	if not es.has_setting(SETTING):
		es.set_setting(SETTING, 0)
	es.set_initial_value(SETTING, 0, false)
	es.add_property_info({ "name": SETTING, "type": TYPE_INT, "hint": PROPERTY_HINT_ENUM, "hint_string": SETTING_HINT })
