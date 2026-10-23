"""Optional local prompt-free RomajiASR worker. Binary stdin/stdout only.

No networking, lyric prompts, microphone, recordings or intermediate audio files.
The parent owns the 15s job watchdog and 30s resident-idle release. Weights are
verified before importing/initializing ORT; no model conversion happens here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

MODEL_SHA = "63077b2673a87dd10038e429e4953679bd60fd80a045ab9e6e6b7aeeaa32c7ab"
ORIGINAL_SHA = "7006ab5216c7ac0c68446c0c062e7e21358f942d7e6acb67ddaef132ef1d9d7f"
VOCAB_SHA = "4e96b35f058685aa1ac63b1c9e1cc386fa75d85ede5d55997fbbac6e7ec932bb"


def verified_file(directory, name, expected, size=None):
    file = (directory / name).resolve(strict=True)
    if file.parent != directory or not file.is_file():
        raise ValueError("Model file escaped its directory")
    if size is not None and file.stat().st_size != size:
        raise ValueError("Unexpected model size")
    digest = hashlib.sha256()
    with file.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError("Model provenance mismatch")
    return file


def send(value, body=b""):
    header = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
    if len(header) > 16384 or len(body) > 500000:
        raise ValueError("Protocol output exceeded bounds")
    sys.stdout.buffer.write(header)
    if body:
        sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def read_exact(size):
    result = bytearray()
    while len(result) < size:
        chunk = sys.stdin.buffer.read(size - len(result))
        if not chunk:
            raise EOFError("Incomplete PCM")
        result.extend(chunk)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    directory = Path(args.model_dir).resolve(strict=True)
    verified_file(directory, "model.onnx", ORIGINAL_SHA, 189312907)
    model = verified_file(directory, "model.with-logits.onnx", MODEL_SHA, 189312978)
    vocabulary_file = verified_file(directory, "phoneme_vocab.json", VOCAB_SHA)
    vocabulary_map = json.loads(vocabulary_file.read_text(encoding="utf-8"))
    if len(vocabulary_map) != 161 or sorted(vocabulary_map.values()) != list(range(161)):
        raise ValueError("Unexpected phoneme vocabulary")
    vocabulary = [None] * 161
    for phone, index in vocabulary_map.items():
        vocabulary[index] = phone
    if vocabulary[0] != "<blank>":
        raise ValueError("Unexpected blank token")

    import numpy as np
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    # Capture windows are short and separated by seconds. Retaining peak
    # activation arenas or spinning worker threads between windows wastes the
    # desktop client's memory/CPU without improving acoustic evidence.
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    options.add_session_config_entry("session.intra_op.allow_spinning", "0")
    options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    options.log_severity_level = 3
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if len(inputs) != 1 or inputs[0].name != "input_values" or inputs[0].type != "tensor(float)" or len(inputs[0].shape) != 2:
        raise ValueError("Unexpected acoustic model inputs")
    if any(isinstance(value, int) for value in inputs[0].shape) or len(outputs) != 2:
        raise ValueError("Dynamic PCM input and original-plus-logits outputs required")
    send({"type": "ready", "protocol": 1, "modelSha256": MODEL_SHA, "originalSha256": ORIGINAL_SHA,
          "vocabSha256": VOCAB_SHA, "sampleRate": 16000, "strideSamples": 320, "receptiveFieldSamples": 400,
          "blankId": 0, "vocabulary": vocabulary})
    previous_id = 0
    while True:
        line = sys.stdin.buffer.readline(16385)
        if not line:
            return
        if len(line) > 16384 or not line.endswith(b"\n"):
            raise ValueError("Invalid PCM header")
        value = json.loads(line)
        if not isinstance(value, dict) or set(value) != {"type", "id", "samples", "bytes"}:
            raise ValueError("Unexpected request fields")
        request_id, count = value["id"], value["samples"]
        if value["type"] != "recognize" or type(request_id) is not int or request_id <= previous_id or request_id > 2**53 - 1:
            raise ValueError("Invalid request identity")
        if type(count) is not int or not 96000 <= count <= 240000 or type(value["bytes"]) is not int or value["bytes"] != count * 4:
            raise ValueError("Expected finite 6-15s mono 16kHz PCM")
        samples = np.frombuffer(read_exact(value["bytes"]), dtype="<f4")
        if not np.isfinite(samples).all() or np.max(np.abs(samples)) > 8:
            raise ValueError("Invalid PCM samples")
        previous_id = request_id
        started = time.perf_counter()
        result = session.run(None, {"input_values": samples[None, :]})
        ids = np.asarray(result[0][0], dtype="<i4")
        logits = np.asarray(result[1][0], dtype="<f4")
        frames = (count - 400) // 320 + 1
        if ids.shape != (frames,) or logits.shape != (frames, 161) or not np.isfinite(logits).all():
            raise ValueError("Invalid acoustic model output")
        if not np.array_equal(ids, np.argmax(logits, axis=-1)):
            raise ValueError("Logits export disagrees with original model")
        body = logits.tobytes(order="C") + ids.tobytes(order="C")
        send({"type": "result", "id": request_id, "samples": count, "frames": frames, "width": 161,
              "logitBytes": logits.nbytes, "idBytes": ids.nbytes, "elapsedMs": round((time.perf_counter() - started) * 1000)}, body)


if __name__ == "__main__":
    try:
        main()
    except (BrokenPipeError, EOFError):
        sys.exit(0)
    except Exception:
        # No audio, file paths, transcriptions or arbitrary exception text on stdout.
        try:
            send({"type": "error", "message": "local-ctc-runtime-failed"})
        finally:
            sys.exit(1)
