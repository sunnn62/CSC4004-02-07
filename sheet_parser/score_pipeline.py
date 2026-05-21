from __future__ import annotations

"""
악보 파일을 피아노 코칭 서비스에서 사용할 JSON으로 변환하는 파이프라인.

역할은 크게 두 가지
1. PDF/이미지 악보는 전처리 후 Oemer로 MusicXML을 생성한다.
2. MusicXML/XML/MXL은 music21로 파싱해서 프론트엔드 채점용 JSON으로 바꾼다.

OMR(Oemer) 결과는 BPM, 조표, 박자표를 자주 놓치기 때문에
사용자가 직접 보정값을 넣을 수 있도록 설계했습니다.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import music21
from pdf2image import convert_from_path
from PIL import Image, ImageEnhance, ImageOps

# music21 버전에 따라 PedalMark 클래스가 없을 수 있다.
# 없으면 페달 추출을 건너뛰고 경고만 남긴다.
_PEDAL_MARK_CLS: type | None = getattr(music21.expressions, "PedalMark", None)

SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
SUPPORTED_MUSICXML_EXTENSIONS = {".musicxml", ".xml", ".mxl"}
DEFAULT_POPPLER_PATH = (
    Path(__file__).resolve().parent
    / "poppler"
    / "poppler-26.02.0"
    / "Library"
    / "bin"
)


@dataclass
class MetadataOverrides:
    """Oemer/music21이 놓친 악보 기본 정보를 사용자가 덮어쓸 때 사용한다."""

    title: str | None = None
    tempo: float | None = None
    time_signature: str | None = None
    key_fifths: int | None = None
    key_name: str | None = None


@dataclass
class ParseWarning:
    """파싱은 성공했지만 사용자가 확인해야 하는 문제를 프론트에 전달하기 위한 구조."""

    code: str
    message: str
    severity: str = "warning"


def sha256_file(path: Path) -> str:
    """같은 악보를 반복 분석하지 않도록 파일 내용 기반 캐시 키를 만든다."""

    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def page_sort_key(path: Path) -> int:
    """page_1, page_2, ..., page_10 순서가 문자열 정렬 때문에 꼬이지 않게 한다."""

    match = re.search(r"page_(\d+)", path.stem)
    return int(match.group(1)) if match else 0


def preprocess_score_file(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    dpi: int = 220,
    contrast: float = 2.0,
    poppler_path: str | Path | None = DEFAULT_POPPLER_PATH,
    max_pages: int | None = None,
) -> list[Path]:
    """
    PDF/이미지 악보를 Oemer가 읽기 좋은 흑백 PNG 페이지로 변환한다.

    PDF는 Poppler로 페이지별 이미지로 만들고, JPG/PNG는 그대로 열어서
    흑백화, 대비 강화, 여백 크롭만 적용한다.
    """

    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    suffix = input_path.suffix.lower()
    if suffix == ".pdf":
        # 개발 중에는 1페이지만 테스트하는 경우가 많아서, PDF 변환 단계부터 페이지 수를 제한한다.
        pdf_options: dict[str, Any] = {
            "dpi": dpi,
            "poppler_path": str(poppler_path) if poppler_path else None,
        }
        if max_pages is not None:
            pdf_options["first_page"] = 1
            pdf_options["last_page"] = max_pages
        images = convert_from_path(str(input_path), **pdf_options)
    elif suffix in SUPPORTED_IMAGE_EXTENSIONS:
        images = [Image.open(input_path)]
    else:
        raise ValueError(f"Unsupported score file type: {suffix}")

    processed_paths: list[Path] = []
    for index, image in enumerate(images, start=1):
        # Oemer는 컬러보다 선이 또렷한 흑백 악보 이미지에서 더 안정적으로 동작한다.
        gray = image.convert("L")
        gray = ImageEnhance.Contrast(gray).enhance(contrast)

        # 배경 여백이 너무 크면 Oemer가 악보 위치를 잡기 어려워해서 내용 기준으로 한 번 잘라낸다.
        inverted = ImageOps.invert(gray)
        bbox = inverted.getbbox()
        if bbox:
            padding = 50
            left, top, right, bottom = bbox
            gray = gray.crop(
                (
                    max(0, left - padding),
                    max(0, top - padding),
                    min(gray.width, right + padding),
                    min(gray.height, bottom + padding),
                )
            )

        output_path = output_dir / f"page_{index}.png"
        gray.save(output_path, "PNG")
        processed_paths.append(output_path)

    return processed_paths


def run_oemer_on_pages(
    page_paths: list[Path],
    output_dir: str | Path,
    *,
    max_pages: int | None = None,
    without_deskew: bool = True,
) -> list[Path]:
    """
    전처리된 PNG 페이지들을 Oemer에 넣어 MusicXML 파일로 변환한다.

    Windows에서 Oemer 내부의 OpenCV가 한글 경로를 못 읽는 문제가 있어서,
    실제 실행은 tempfile로 만든 ASCII 경로에서 수행한다.
    """

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    oemer_exe = shutil.which("oemer")
    if not oemer_exe:
        raise RuntimeError("Oemer executable was not found. Install it with: python -m pip install oemer")

    selected_pages = sorted(page_paths, key=page_sort_key)
    if max_pages is not None:
        selected_pages = selected_pages[:max_pages]

    xml_paths: list[Path] = []
    with tempfile.TemporaryDirectory(prefix="oemer_") as temp_root:
        temp_dir = Path(temp_root)

        for index, source_page in enumerate(selected_pages, start=1):
            # 한글/공백이 섞인 원본 경로를 피하기 위해 임시 폴더에 안전한 파일명으로 복사한다.
            safe_png_path = temp_dir / f"page_{index:03d}.png"
            shutil.copy2(source_page, safe_png_path)

            command = [oemer_exe, str(safe_png_path), "-o", str(temp_dir)]
            if without_deskew:
                # PDF에서 뽑은 깨끗한 악보는 기울기 보정을 끄는 편이 조금 더 빠르다.
                command.append("-d")

            print(f"[oemer] page {index}/{len(selected_pages)}: {source_page.name}")
            result = subprocess.run(command, text=True, stderr=subprocess.PIPE)
            if result.returncode != 0:
                detail = (result.stderr or "").strip()
                raise RuntimeError(
                    f"Oemer failed on {source_page.name} (exit {result.returncode})"
                    + (f":\n{detail}" if detail else "")
                )

            temp_xml_path = temp_dir / f"page_{index:03d}.musicxml"
            if not temp_xml_path.exists():
                raise RuntimeError(f"Oemer finished but did not create MusicXML for {source_page.name}")

            final_xml_path = output_dir / f"page_{index}.musicxml"
            shutil.copy2(temp_xml_path, final_xml_path)
            xml_paths.append(final_xml_path)

    return xml_paths


def read_musicxml_sound_tempo(xml_path: str | Path) -> float | None:
    """music21이 못 잡는 <sound tempo="..."> 형태의 BPM을 직접 읽는다."""

    try:
        root = ET.parse(xml_path).getroot()
    except ET.ParseError:
        return None

    for sound in root.iter("sound"):
        tempo = sound.attrib.get("tempo")
        if tempo:
            try:
                return float(tempo)
            except ValueError:
                return None
    return None


def key_name_from_fifths(fifths: int) -> str:
    return music21.key.KeySignature(fifths).asKey().name


def time_signature_to_quarter_length(time_signature: str) -> float:
    """4/4, 3/4 같은 박자표를 한 마디의 quarterLength 값으로 바꾼다."""

    try:
        beats, beat_type = time_signature.split("/", maxsplit=1)
        return float(beats) * (4.0 / float(beat_type))
    except (ValueError, ZeroDivisionError):
        return 4.0


def extract_metadata(
    score: music21.stream.Score,
    xml_path: str | Path,
    overrides: MetadataOverrides,
) -> tuple[dict[str, Any], list[ParseWarning]]:
    """
    제목, BPM, 박자표, 조표를 추출한다.

    우선순위는 사용자 보정값 > MusicXML에서 읽은 값 > 기본값이다.
    OMR 결과가 불안정한 부분이라 기본값을 쓸 때는 warning을 남긴다.
    """

    warnings: list[ParseWarning] = []

    title = overrides.title
    if title is None and score.metadata and score.metadata.title:
        title = score.metadata.title
    if title is None:
        title = Path(xml_path).stem

    tempo = overrides.tempo
    tempo_marks = list(score.recurse().getElementsByClass(music21.tempo.MetronomeMark))
    if tempo is None and tempo_marks and tempo_marks[0].number:
        tempo = float(tempo_marks[0].number)
    if tempo is None:
        tempo = read_musicxml_sound_tempo(xml_path)
    if tempo is None:
        tempo = 120.0
        warnings.append(
            ParseWarning(
                "MISSING_TEMPO",
                "Tempo was not detected. Defaulted to 120 BPM. Ask the user to confirm BPM.",
            )
        )

    time_signature = overrides.time_signature
    time_signatures = list(score.recurse().getElementsByClass(music21.meter.TimeSignature))
    if time_signature is None and time_signatures:
        time_signature = time_signatures[0].ratioString
    if time_signature is None:
        time_signature = "4/4"
        warnings.append(
            ParseWarning(
                "MISSING_TIME_SIGNATURE",
                "Time signature was not detected. Defaulted to 4/4.",
            )
        )

    key_fifths = overrides.key_fifths
    key_signatures = list(score.recurse().getElementsByClass(music21.key.KeySignature))
    if key_fifths is None and key_signatures:
        key_fifths = key_signatures[0].sharps
    if key_fifths is None:
        key_fifths = 0
        warnings.append(
            ParseWarning(
                "MISSING_KEY_SIGNATURE",
                "Key signature was not detected. Defaulted to C major.",
            )
        )

    key_name = overrides.key_name or key_name_from_fifths(key_fifths)

    return (
        {
            "title": title,
            "tempo": tempo,
            "timeSignature": time_signature,
            "keySignature": key_name,
            "keyFifths": key_fifths,
        },
        warnings,
    )


def staff_to_hand(staff_number: int | None, part_index: int) -> str:
    """MusicXML의 staff 번호를 오른손/왼손으로 변환한다."""

    if staff_number == 1:
        return "right"
    if staff_number == 2:
        return "left"
    return "right" if part_index == 0 else "left"


def element_pitches(element: music21.base.Music21Object) -> list[int]:
    """단일음/화음을 모두 MIDI 번호 배열로 통일한다."""

    if isinstance(element, music21.note.Note):
        return [element.pitch.midi]
    if isinstance(element, music21.chord.Chord):
        return sorted(pitch.midi for pitch in element.pitches)
    return []


def parse_musicxml_to_json(
    xml_path: str | Path,
    *,
    overrides: MetadataOverrides | None = None,
    source_page: int | None = None,
    measure_offset: int = 0,
) -> dict[str, Any]:
    """
    MusicXML 하나를 프론트엔드 채점용 JSON 구조로 변환한다.

    출력은 마디 단위이며, 각 note event에는 시작 박자, 길이, MIDI pitch,
    손 구분, 쉼표 여부 등이 들어간다.
    """

    xml_path = Path(xml_path)
    overrides = overrides or MetadataOverrides()
    score = music21.converter.parse(str(xml_path))

    metadata, warnings = extract_metadata(score, xml_path, overrides)
    measures_map: dict[int, list[dict[str, Any]]] = {}
    measure_info_map: dict[int, dict[str, Any]] = {}

    dynamic_to_velocity = {
        "ppp": 16,
        "pp": 33,
        "p": 49,
        "mp": 64,
        "mf": 80,
        "f": 96,
        "ff": 112,
        "fff": 127,
    }

    for part_index, part in enumerate(score.parts):
        for measure in part.getElementsByClass(music21.stream.Measure):
            if measure.number is None:
                continue

            measure_number = int(measure.number) + measure_offset
            measure_absolute_offset = float(measure.offset)

            if measure_number not in measures_map:
                measures_map[measure_number] = []
                measure_info_map[measure_number] = {
                    "repeatStart": False,
                    "repeatEnd": False,
                    "dynamics": [],
                    "pedals": [],
                    "tempos": [],
                }

            if isinstance(measure.leftBarline, music21.bar.Repeat) and measure.leftBarline.direction == "start":
                measure_info_map[measure_number]["repeatStart"] = True
            if isinstance(measure.rightBarline, music21.bar.Repeat) and measure.rightBarline.direction == "end":
                measure_info_map[measure_number]["repeatEnd"] = True

            for tempo_mark in measure.recurse().getElementsByClass(music21.tempo.MetronomeMark):
                bpm = float(tempo_mark.number) if tempo_mark.number else None
                if bpm is None and not tempo_mark.text:
                    continue
                absolute_beat = float(measure_absolute_offset + tempo_mark.offset)
                measure_info_map[measure_number]["tempos"].append(
                    {
                        "bpm": bpm,
                        "text": tempo_mark.text or None,
                        "startBeat": float(tempo_mark.offset),
                        "absoluteStartBeat": absolute_beat,
                    }
                )

            for dynamic in measure.recurse().getElementsByClass(music21.dynamics.Dynamic):
                absolute_beat = float(measure_absolute_offset + dynamic.offset)
                measure_info_map[measure_number]["dynamics"].append(
                    {
                        "mark": dynamic.value,
                        "targetVelocity": dynamic_to_velocity.get(dynamic.value, 80),
                        "startBeat": float(dynamic.offset),
                        "absoluteStartBeat": absolute_beat,
                    }
                )

            if _PEDAL_MARK_CLS is not None:
                for pedal in measure.recurse().getElementsByClass(_PEDAL_MARK_CLS):
                    absolute_beat = float(measure_absolute_offset + pedal.offset)
                    pedal_type = (
                        getattr(pedal, "type", None)
                        or getattr(pedal, "pedalForm", None)
                        or "start"
                    )
                    measure_info_map[measure_number]["pedals"].append(
                        {
                            "type": pedal_type,
                            "startBeat": float(pedal.offset),
                            "absoluteStartBeat": absolute_beat,
                        }
                    )

            for element in measure.flatten().notesAndRests:
                # flatten()을 써서 voice가 여러 개여도 한 마디 안의 음표를 시간순으로 다룬다.
                # music21은 note에 staffNumber를 직접 노출하지 않는다.
                # editorial.staffNumber → 직접 attribute 순으로 시도하고, 없으면 part_index로 손 구분.
                staff_number = getattr(
                    getattr(element, "editorial", None), "staffNumber", None
                ) or getattr(element, "staffNumber", None)
                tie_status = element.tie.type if hasattr(element, "tie") and element.tie else None
                articulations = [
                    articulation.name
                    for articulation in getattr(element, "articulations", [])
                ]

                note_event = {
                    "id": "",
                    "sourcePage": source_page,
                    "measure": measure_number,
                    "pitches": element_pitches(element),
                    "duration": float(element.duration.quarterLength),
                    "startBeat": float(element.offset),
                    "absoluteStartBeat": float(measure_absolute_offset + element.offset),
                    "hand": staff_to_hand(staff_number, part_index),
                    "staff": staff_number,
                    "isRest": isinstance(element, music21.note.Rest),
                    "tie": tie_status,
                    "isGrace": bool(element.duration.isGrace),
                    "articulations": articulations,
                }
                measures_map[measure_number].append(note_event)

    output_measures: list[dict[str, Any]] = []
    note_counter = 1
    for measure_number in sorted(measures_map):
        notes = sorted(
            measures_map[measure_number],
            key=lambda item: (item["absoluteStartBeat"], 0 if item["hand"] == "right" else 1, item["pitches"]),
        )
        for note in notes:
            note["id"] = f"n{note_counter}"
            note_counter += 1

        info = measure_info_map[measure_number]
        output_measures.append(
            {
                "number": measure_number,
                "repeatStart": info["repeatStart"],
                "repeatEnd": info["repeatEnd"],
                "tempos": sorted(info["tempos"], key=lambda item: item["absoluteStartBeat"]),
                "dynamics": sorted(info["dynamics"], key=lambda item: item["absoluteStartBeat"]),
                "pedals": sorted(info["pedals"], key=lambda item: item["absoluteStartBeat"]),
                "notes": notes,
            }
        )

    validation_warnings = validate_parsed_score(metadata, output_measures)
    warnings.extend(validation_warnings)

    return {
        "metadata": metadata,
        "measures": output_measures,
        "warnings": [asdict(warning) for warning in warnings],
        "source": {
            "musicxmlPath": str(xml_path),
            "sourcePage": source_page,
        },
    }


def validate_parsed_score(
    metadata: dict[str, Any],
    measures: list[dict[str, Any]],
) -> list[ParseWarning]:
    """결과 JSON이 채점 기준 데이터로 쓰기 전에 최소한 확인해야 할 위험 요소를 찾는다."""

    warnings: list[ParseWarning] = []

    if not measures:
        warnings.append(ParseWarning("NO_MEASURES", "No measures were parsed.", "error"))
        return warnings

    note_count = sum(
        1
        for measure in measures
        for note in measure["notes"]
        if not note["isRest"] and note["pitches"]
    )
    if note_count == 0:
        warnings.append(ParseWarning("NO_NOTES", "No pitched notes were parsed.", "error"))

    if metadata["keyFifths"] == 0:
        warnings.append(
            ParseWarning(
                "CHECK_KEY_SIGNATURE",
                "Key signature is C major / A minor. This is often an OMR miss for sharp/flat-heavy scores.",
            )
        )

    if metadata["tempo"] == 120.0:
        warnings.append(
            ParseWarning(
                "CHECK_TEMPO",
                "Tempo is the default 120 BPM. Confirm it with the user or source score.",
            )
        )

    return warnings


def midi_to_pitch_name(midi_number: int) -> str:
    """프론트 결과 화면에서 사람이 읽을 수 있도록 MIDI 번호를 C4 같은 이름으로 바꾼다."""

    return music21.pitch.Pitch(midi=midi_number).nameWithOctave


def should_play_note(note: dict[str, Any]) -> bool:
    """쉼표이거나 붙임줄로 이어지는 뒤쪽 음표면 새로 타건하지 않아도 된다."""

    if note["isRest"] or not note["pitches"]:
        return False
    return note.get("tie") not in {"continue", "stop"}


def build_onset_id(measure_number: int, note: dict[str, Any]) -> str | None:
    """
    같은 시점에 눌러야 하는 음들을 묶기 위한 ID.

    MIDI 비교 파트에서 같은 onsetId를 가진 note event들을 하나의 동시 타건 묶음으로 볼 수 있다.
    """

    if not should_play_note(note):
        return None
    start = f"{note['startBeat']:.3f}".rstrip("0").rstrip(".")
    return f"m{measure_number}_b{start}_{note['hand']}"


def build_tempo_map(metadata: dict[str, Any], measures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """마디 안에 흩어진 템포 변경 정보를 프론트 타이머가 쓰기 쉬운 전역 배열로 모은다."""

    tempo_map = [{"bpm": metadata["tempo"], "text": None, "absoluteStartBeat": 0.0}]
    seen = {(float(metadata["tempo"]), 0.0)}

    for measure in measures:
        for tempo in measure["tempos"]:
            bpm = tempo.get("bpm")
            absolute_start = float(tempo["absoluteStartBeat"])
            if bpm is None:
                continue

            key = (float(bpm), absolute_start)
            if key in seen:
                continue

            tempo_map.append(
                {
                    "bpm": float(bpm),
                    "text": tempo.get("text"),
                    "absoluteStartBeat": absolute_start,
                }
            )
            seen.add(key)

    return sorted(tempo_map, key=lambda item: item["absoluteStartBeat"])


def estimate_duration_seconds(total_beats: float, tempo_map: list[dict[str, Any]]) -> float:
    """tempoMap을 기준으로 전체 악보의 대략적인 재생 시간을 초 단위로 계산한다."""

    if not tempo_map:
        return 0.0

    duration = 0.0
    for index, tempo in enumerate(tempo_map):
        start = float(tempo["absoluteStartBeat"])
        end = (
            float(tempo_map[index + 1]["absoluteStartBeat"])
            if index + 1 < len(tempo_map)
            else total_beats
        )
        if end <= start:
            continue
        duration += (end - start) * 60.0 / float(tempo["bpm"])

    return round(duration, 3)


def to_frontend_schema(data: dict[str, Any], *, include_diagnostics: bool = False) -> dict[str, Any]:
    """
    팀원들과 합의한 최종 JSON 스키마에 맞게 내부 진단용 필드를 제거한다.

    내부 처리에는 keyFifths, sourcePage, staff, warnings 같은 값이 유용하지만
    프론트/D 파트에 넘기는 최종 JSON은 최대한 단순하고 고정된 구조가 좋다.
    """

    metadata = data["metadata"]
    output = {
        "metadata": {
            "title": metadata["title"],
            "tempo": metadata["tempo"],
            "timeSignature": metadata["timeSignature"],
            "keySignature": metadata["keySignature"],
        },
        "tempoMap": [],
        "measures": [],
    }

    total_beats = 0.0

    for measure in data["measures"]:
        measure_start = None
        measure_end = None

        output_measure = {
            "number": measure["number"],
            "startBeat": 0.0,
            "endBeat": 0.0,
            "repeatStart": measure["repeatStart"],
            "repeatEnd": measure["repeatEnd"],
            "tempos": measure["tempos"],
            "dynamics": measure["dynamics"],
            "pedals": measure["pedals"],
            "notes": [],
        }

        for note in measure["notes"]:
            absolute_end_beat = note["absoluteStartBeat"] + note["duration"]
            measure_start = (
                note["absoluteStartBeat"]
                if measure_start is None
                else min(measure_start, note["absoluteStartBeat"])
            )
            measure_end = absolute_end_beat if measure_end is None else max(measure_end, absolute_end_beat)

            output_measure["notes"].append(
                {
                    "id": note["id"],
                    "pitches": note["pitches"],
                    "pitchNames": [midi_to_pitch_name(pitch) for pitch in note["pitches"]],
                    "duration": note["duration"],
                    "startBeat": note["startBeat"],
                    "absoluteStartBeat": note["absoluteStartBeat"],
                    "absoluteEndBeat": absolute_end_beat,
                    "hand": note["hand"],
                    "isRest": note["isRest"],
                    "shouldPlay": should_play_note(note),
                    "onsetId": build_onset_id(measure["number"], note),
                    "tie": note["tie"],
                    "isGrace": note["isGrace"],
                    "articulations": note["articulations"],
                }
            )

        output_measure["startBeat"] = float(measure_start or 0.0)
        output_measure["endBeat"] = float(measure_end or output_measure["startBeat"])
        total_beats = max(total_beats, output_measure["endBeat"])
        output["measures"].append(output_measure)

    output["tempoMap"] = build_tempo_map(output["metadata"], output["measures"])
    output["metadata"]["totalBeats"] = total_beats
    output["metadata"]["estimatedDurationSec"] = estimate_duration_seconds(total_beats, output["tempoMap"])

    if include_diagnostics:
        output["diagnostics"] = {
            "warnings": data.get("warnings", []),
            "source": data.get("source", {}),
            "keyFifths": metadata.get("keyFifths"),
        }

    return output


def merge_page_json(page_results: list[dict[str, Any]], overrides: MetadataOverrides) -> dict[str, Any]:
    """
    페이지별로 나온 JSON을 하나의 곡 JSON으로 합친다.

    Oemer는 페이지별 MusicXML을 따로 만들기 때문에 마디 번호와 absoluteStartBeat를
    다시 이어 붙여야 프론트엔드 타임라인이 끊기지 않는다.
    """

    if not page_results:
        raise ValueError("No page results to merge.")

    merged = {
        "metadata": page_results[0]["metadata"],
        "measures": [],
        "warnings": [],
        "source": {
            "pages": [result["source"] for result in page_results],
        },
    }

    if overrides.title is not None:
        merged["metadata"]["title"] = overrides.title
    if overrides.tempo is not None:
        merged["metadata"]["tempo"] = overrides.tempo
    if overrides.time_signature is not None:
        merged["metadata"]["timeSignature"] = overrides.time_signature
    if overrides.key_fifths is not None:
        merged["metadata"]["keyFifths"] = overrides.key_fifths
        merged["metadata"]["keySignature"] = overrides.key_name or key_name_from_fifths(overrides.key_fifths)

    next_note_id = 1
    next_measure_number = 1
    beat_offset = 0.0
    measure_length = time_signature_to_quarter_length(merged["metadata"].get("timeSignature", "4/4"))

    for page_result in page_results:
        page_measures = sorted(page_result["measures"], key=lambda item: item["number"])
        local_page_end = len(page_measures) * measure_length

        # 마지막 마디가 불완전하거나 OMR이 박자를 다르게 잡은 경우를 대비해 실제 note 끝도 같이 본다.
        for measure in page_measures:
            for note in measure["notes"]:
                local_page_end = max(local_page_end, note["absoluteStartBeat"] + note["duration"])

        for measure in page_result["measures"]:
            copied_measure = dict(measure)
            copied_measure["number"] = next_measure_number

            for event_key in ("tempos", "dynamics", "pedals"):
                copied_measure[event_key] = [
                    {
                        **event,
                        "absoluteStartBeat": event["absoluteStartBeat"] + beat_offset,
                    }
                    for event in measure[event_key]
                ]

            copied_notes = []
            for note in measure["notes"]:
                copied_note = dict(note)
                copied_note["id"] = f"n{next_note_id}"
                copied_note["measure"] = copied_measure["number"]
                copied_note["absoluteStartBeat"] = note["absoluteStartBeat"] + beat_offset
                next_note_id += 1
                copied_notes.append(copied_note)
            copied_measure["notes"] = copied_notes
            merged["measures"].append(copied_measure)
            next_measure_number += 1

        beat_offset += local_page_end
        merged["warnings"].extend(page_result.get("warnings", []))

    return merged


def parse_score_file(
    input_path: str | Path,
    output_json_path: str | Path,
    *,
    work_dir: str | Path | None = None,
    overrides: MetadataOverrides | None = None,
    max_omr_pages: int | None = 1,
    dpi: int = 220,
    use_cache: bool = True,
    include_diagnostics: bool = False,
) -> dict[str, Any]:
    """
    외부에서 호출할 메인 함수.

    입력 파일 형식에 따라 MusicXML 직접 파싱 경로와 PDF/이미지 OMR 경로로 나뉜다.
    결과는 output_json_path에 저장하고, 같은 조건으로 다시 호출하면 캐시를 재사용한다.
    """

    input_path = Path(input_path)
    output_json_path = Path(output_json_path)
    work_dir = Path(work_dir) if work_dir else input_path.parent / "score_work"
    overrides = overrides or MetadataOverrides()

    work_dir.mkdir(parents=True, exist_ok=True)
    output_json_path.parent.mkdir(parents=True, exist_ok=True)

    cache_key = hashlib.sha256(
        json.dumps(
            {
                "file": sha256_file(input_path),
                "overrides": asdict(overrides),
                "max_omr_pages": max_omr_pages,
                "dpi": dpi,
                "include_diagnostics": include_diagnostics,
            },
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    cache_path = work_dir / "cache" / f"{cache_key}.json"

    if use_cache and cache_path.exists():
        # OMR은 오래 걸리기 때문에 같은 파일/옵션 조합은 바로 재사용한다.
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        output_json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return data

    suffix = input_path.suffix.lower()
    if suffix in SUPPORTED_MUSICXML_EXTENSIONS:
        # 이미 구조화된 악보 파일이면 Oemer 없이 바로 파싱한다. 서비스에서 가장 빠른 경로다.
        internal_data = parse_musicxml_to_json(input_path, overrides=overrides)
    elif suffix == ".pdf" or suffix in SUPPORTED_IMAGE_EXTENSIONS:
        # 이미지 계열은 전처리 -> Oemer -> MusicXML -> JSON 순서로 처리한다.
        pages_dir = work_dir / "processed_pages"
        xml_dir = work_dir / "musicxml"
        page_paths = preprocess_score_file(input_path, pages_dir, dpi=dpi, max_pages=max_omr_pages)
        xml_paths = run_oemer_on_pages(page_paths, xml_dir, max_pages=max_omr_pages)

        page_results = []
        for page_index, xml_path in enumerate(xml_paths, start=1):
            page_data = parse_musicxml_to_json(
                xml_path,
                overrides=overrides,
                source_page=page_index,
            )
            page_results.append(page_data)

        internal_data = merge_page_json(page_results, overrides)
    else:
        raise ValueError(f"Unsupported score file type: {suffix}")

    data = to_frontend_schema(internal_data, include_diagnostics=include_diagnostics)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    output_json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert a score file to piano coaching JSON.")
    parser.add_argument("input", help="PDF, PNG/JPG, MusicXML, XML, or MXL score file.")
    parser.add_argument("-o", "--output", default="score_output.json", help="Output JSON path.")
    parser.add_argument("--work-dir", default=None, help="Working directory for pages, OMR, and cache.")
    parser.add_argument("--title", default=None)
    parser.add_argument("--tempo", type=float, default=None)
    parser.add_argument("--time-signature", default=None)
    parser.add_argument("--key-fifths", type=int, default=None)
    parser.add_argument("--key-name", default=None)
    parser.add_argument("--max-omr-pages", type=int, default=1)
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--include-diagnostics", action="store_true")
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    overrides = MetadataOverrides(
        title=args.title,
        tempo=args.tempo,
        time_signature=args.time_signature,
        key_fifths=args.key_fifths,
        key_name=args.key_name,
    )
    data = parse_score_file(
        args.input,
        args.output,
        work_dir=args.work_dir,
        overrides=overrides,
        max_omr_pages=args.max_omr_pages,
        dpi=args.dpi,
        use_cache=not args.no_cache,
        include_diagnostics=args.include_diagnostics,
    )
    print(f"Saved JSON: {args.output}")
    print(f"Measures: {len(data.get('measures', []))}")
    diagnostics = data.get("diagnostics", {})
    print(f"Warnings: {len(diagnostics.get('warnings', []))}")


if __name__ == "__main__":
    main()
