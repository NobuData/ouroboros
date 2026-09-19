package conn

import (
	"encoding/json"
	"regexp"
	"strconv"
)

// This file is the Go reading of schemas/runner-protocol/v1.json, as declarative tables
// rather than sixteen hand-written validators.
//
// The tables are the point. A hand-written validator per message drifts from the
// schema field by field, and the drift is invisible because each half looks reasonable
// on its own; a table sits beside the schema's `$defs` and can be read against it in one
// pass. What keeps them honest is not this comment but
// schemas/runner-protocol/fixtures/expected.json, which both this package and the
// TypeScript gateway ([#251]) assert against.
//
// [#251]: https://github.com/NobuData/ouroboros/issues/251

// kind is a JSON type as this validator distinguishes them. They are bits, so a field
// that may be an object or null is `kindObject | kindNull`.
type kind uint8

const (
	kindString kind = 1 << iota
	kindInteger
	kindNumber // any JSON number, integer or fractional
	kindBool
	kindObject
	kindArray
	kindNull
)

// field is one entry in a payload contract: what it is called, what it may be, and
// every bound on it.
//
// A zero bound is an absent bound. No field in this protocol has a meaningful minimum
// length of zero, a maximum length of zero or a zero item count, so the zero value
// reading as "unset" costs nothing and keeps the tables readable.
type field struct {
	name     string
	kinds    kind
	optional bool

	enum    []string       // a closed set of string values
	pattern *regexp.Regexp // a published shape for a string

	min, max       *float64 // numeric bounds
	minLen, maxLen int      // string length bounds, in characters
	minItems       int      // array bounds
	maxItems       int
	maxProps       int // object bounds, for an open map

	fields []field // a closed object's own contract
	item   *field  // an array's element contract
	value  *field  // an OPEN map's value contract; suppresses the unknown-key check
}

// messageSpec is one message type's payload contract: its fields, and the cross-field
// rules a per-field table cannot express.
type messageSpec struct {
	fields []field
	extra  func(payload map[string]any) Diagnostics
}

// num is a bound, as a pointer so that zero is a bound rather than an absence.
func num(v float64) *float64 { return &v }

// The vocabularies, named once because more than one message reads them.
var (
	archValues     = []string{"linux/arm64", "linux/x86_64", "darwin/arm64"}
	executorValues = []string{"container", "shell"}
	phaseValues    = []string{"fetch", "prepare", "run", "upload"}
	stateValues    = []string{"idle", "busy", "draining"}
	outcomeValues  = []string{"succeeded", "failed", "cancelled", "timed_out", "errored"}
	streamValues   = []string{StreamStdout, StreamStderr, StreamRunner}
	refuseValues   = []string{
		"version.below_minimum", "version.unsupported",
		"identity.unknown", "identity.revoked",
		"pool.unknown", "capacity.exhausted",
	}
	declineValues = []string{
		"draining", "busy", "unsupported_executor",
		"image_unavailable", "capacity", "expired",
	}
	cancelValues = []string{CancelOperator, CancelReassigned}
	drainValues  = []string{"operator", "upgrade", "decommission", "capacity"}
	byeValues    = []string{"shutdown", "drained", "error", "server_shutdown"}

	// securityModeValues is decision B3's two answers, as `hello.security_mode` reports
	// them — the same two `runners.security_mode` stores.
	securityModeValues = []string{string(SecurityMTLS), string(SecurityBearerFallback)}
)

// The reusable field shapes. Each takes the name it appears under, because the same
// shape carries different names in different messages.
func jobIDField(name string) field {
	return field{name: name, kinds: kindString, pattern: jobRe}
}

func ulidField(name string) field {
	return field{name: name, kinds: kindString, pattern: ulidRe}
}

func timestampField(name string) field {
	return field{name: name, kinds: kindString, pattern: timestampRe}
}

// detailField is the one-sentence explanation several messages carry for an operator:
// always named `detail`, always required, and bounded because it ends up in a log line.
func detailField(maxLen int) field {
	return field{name: "detail", kinds: kindString, minLen: 1, maxLen: maxLen}
}

func percentageField(name string) field {
	return field{name: name, kinds: kindInteger, min: num(0), max: num(100)}
}

func countField(name string) field {
	return field{name: name, kinds: kindInteger, min: num(0)}
}

// specs is every message type's contract. The keys are the enum in v1.json, and
// specFor returning nil is how Decode recognises a type it has never heard of.
var specs = map[Type]*messageSpec{
	TypeHello: {fields: []field{
		{name: "agent", kinds: kindObject, fields: []field{
			{name: "version", kinds: kindString, minLen: 1, maxLen: 64},
			{name: "protocol_min", kinds: kindInteger, min: num(1)},
			{name: "protocol_max", kinds: kindInteger, min: num(1)},
		}},
		{name: "arch", kinds: kindString, enum: archValues},
		{name: "hostname", kinds: kindString, minLen: 1, maxLen: 253},
		{name: "pool", kinds: kindString, minLen: 1, maxLen: 64, optional: true},
		{name: "capabilities", kinds: kindObject, fields: []field{
			{name: "docker", kinds: kindBool},
			{name: "shell", kinds: kindBool},
			{name: "ccache", kinds: kindBool},
			{name: "cpus", kinds: kindInteger, min: num(1)},
			{name: "memory_mb", kinds: kindInteger, min: num(1)},
		}},
		// Optional only because it was added inside line 1 (§ 3). The gateway reads the
		// transport for a hello that omits it.
		{name: "security_mode", kinds: kindString, enum: securityModeValues, optional: true},
		{name: "resume", kinds: kindString, pattern: sessionRe, optional: true},
	}},

	TypeAck: {fields: []field{
		{name: "session", kinds: kindString, pattern: sessionRe},
		{name: "protocol", kinds: kindInteger, min: num(1)},
		{name: "resumed", kinds: kindBool},
		{name: "runner", kinds: kindObject, fields: []field{
			{name: "id", kinds: kindString, pattern: runnerRe},
			{name: "name", kinds: kindString, minLen: 1, maxLen: 253},
			{name: "pool", kinds: kindString, minLen: 1, maxLen: 64},
		}},
		{name: "limits", kinds: kindObject, fields: []field{
			{name: "heartbeat_interval_ms", kinds: kindInteger, min: num(1000), max: num(300000)},
			{name: "heartbeat_jitter_ms", kinds: kindInteger, min: num(0), max: num(60000)},
			{name: "log_chunk_max_bytes", kinds: kindInteger, min: num(1024), max: num(LogChunkMaxBytes)},
			{name: "log_rate_bytes_per_s", kinds: kindInteger, min: num(1024)},
			{name: "offer_ack_ms", kinds: kindInteger, min: num(100)},
			{name: "resume_window_ms", kinds: kindInteger, min: num(1000)},
		}},
		// Optional only because it was added inside line 1 (§ 3, #246). The bounds are the
		// ones runner_pools holds the same two columns to (#249).
		{name: "pool", kinds: kindObject, optional: true, fields: []field{
			{name: "max_concurrency", kinds: kindInteger, min: num(1), max: num(64)},
			{name: "env_allowlist", kinds: kindArray, maxItems: 64,
				item: &field{kinds: kindString, minLen: 1}},
		}},
	}},

	TypeRefuse: {fields: []field{
		{name: "code", kinds: kindString, enum: refuseValues},
		{name: "minimum", kinds: kindInteger | kindNull, min: num(1)},
		detailField(512),
		{name: "retry_after_ms", kinds: kindInteger | kindNull, min: num(0)},
	}},

	TypeHeartbeat: {fields: []field{
		timestampField("sent_at"),
		{name: "state", kinds: kindString, enum: stateValues},
		countField("uptime_s"),
		// The three measurements are null when this machine cannot take them (#245):
		// required, so the key is always there, and never a zero standing in for "unknown".
		{name: "cpu_pct", kinds: kindNumber | kindNull, min: num(0), max: num(100)},
		{name: "memory_used_mb", kinds: kindInteger | kindNull, min: num(0)},
		{name: "memory_total_mb", kinds: kindInteger | kindNull, min: num(1)},
		countField("queue_depth"),
		{name: "job", kinds: kindObject | kindNull, fields: []field{
			jobIDField("id"),
			{name: "phase", kinds: kindString, enum: phaseValues},
			percentageField("pct"),
		}},
	}},

	TypeJobOffer: {
		fields: []field{
			jobIDField("job"),
			{name: "pool", kinds: kindString, minLen: 1, maxLen: 64},
			{name: "executor", kinds: kindString, enum: executorValues},
			// Optional in the table, and then required or forbidden by the executor —
			// see offerExtra, which is the rule the table cannot carry.
			{name: "image", kinds: kindString, minLen: 1, maxLen: 512, optional: true},
			{name: "command", kinds: kindArray, minItems: 1, maxItems: 256,
				item: &field{kinds: kindString}},
			{name: "workdir", kinds: kindString, minLen: 1, maxLen: 1024},
			{name: "env", kinds: kindObject, maxProps: 128,
				value: &field{kinds: kindString, maxLen: 4096}},
			{name: "repository", kinds: kindObject | kindNull, fields: []field{
				{name: "url", kinds: kindString, minLen: 1, maxLen: 1024},
				{name: "ref", kinds: kindString, minLen: 1, maxLen: 256},
				{name: "commit", kinds: kindString, pattern: commitRe},
			}},
			{name: "timeout_s", kinds: kindInteger, min: num(1), max: num(86400)},
			timestampField("expires_at"),
			// Added inside line 1 (#252): absent means a first attempt.
			{name: "attempt", kinds: kindInteger, min: num(1), optional: true},
		},
		extra: offerExtra,
	},

	TypeJobAccept: {fields: []field{
		jobIDField("job"),
		ulidField("offer"),
	}},

	TypeJobDecline: {fields: []field{
		jobIDField("job"),
		ulidField("offer"),
		{name: "reason", kinds: kindString, enum: declineValues},
		detailField(512),
	}},

	TypeJobCancel: {fields: []field{
		jobIDField("job"),
		{name: "reason", kinds: kindString, enum: cancelValues},
		detailField(512),
	}},

	TypeJobStart: {fields: []field{
		jobIDField("job"),
		{name: "attempt", kinds: kindInteger, min: num(1)},
		{name: "executor", kinds: kindString, enum: executorValues},
		timestampField("started_at"),
		{name: "workspace", kinds: kindString, minLen: 1, maxLen: 1024},
	}},

	TypeJobProgress: {fields: []field{
		jobIDField("job"),
		{name: "phase", kinds: kindString, enum: phaseValues},
		percentageField("pct"),
		// The one sentence field with no minimum: a progress frame with nothing to say
		// sends an empty note rather than omitting the key.
		{name: "note", kinds: kindString, maxLen: 256},
	}},

	TypeJobFinish: {
		fields: []field{
			jobIDField("job"),
			{name: "attempt", kinds: kindInteger, min: num(1)},
			{name: "outcome", kinds: kindString, enum: outcomeValues},
			{name: "exit_code", kinds: kindInteger | kindNull, min: num(-1), max: num(255)},
			timestampField("started_at"),
			timestampField("finished_at"),
			{name: "log", kinds: kindObject, fields: []field{
				countField("bytes"),
				countField("chunks"),
				countField("dropped_bytes"),
			}},
			{name: "ccache", kinds: kindObject | kindNull, fields: []field{
				countField("hits"),
				countField("misses"),
				{name: "hit_rate_pct", kinds: kindNumber, min: num(0), max: num(100)},
				countField("size_mb"),
				countField("max_size_mb"),
			}},
			{name: "error", kinds: kindObject | kindNull, fields: []field{
				{name: "code", kinds: kindString, minLen: 1, maxLen: 64},
				detailField(1024),
			}},
		},
		extra: finishExtra,
	},

	TypeLogChunk: {
		fields: []field{
			jobIDField("job"),
			countField("seq"),
			{name: "stream", kinds: kindString, enum: streamValues},
			{name: "encoding", kinds: kindString, enum: []string{EncodingBase64}},
			{name: "data", kinds: kindString, maxLen: LogChunkMaxBase64Chars},
			countField("dropped_bytes"),
		},
		extra: logChunkExtra,
	},

	TypeReceipt: {fields: []field{
		ulidField("of"),
		{name: "of_type", kinds: kindString, enum: []string{string(TypeJobFinish)}},
		{name: "duplicate", kinds: kindBool},
	}},

	TypeDrain: {fields: []field{
		{name: "reason", kinds: kindString, enum: drainValues},
		countField("deadline_ms"),
		detailField(512),
	}},

	// An empty payload is an object, never an absence — so the contract is an empty
	// field list, which still refuses an unknown key.
	TypeUndrain: {fields: []field{}},

	TypeBye: {fields: []field{
		{name: "reason", kinds: kindString, enum: byeValues},
		detailField(512),
		{name: "reconnect_after_ms", kinds: kindInteger | kindNull, min: num(0)},
	}},
}

// specFor is the contract for a message type, or nil when there is no such type.
func specFor(t Type) *messageSpec { return specs[t] }

// offerExtra is job.offer's cross-field rule: the executor decides whether an image is
// required or forbidden.
//
// Forbidden rather than ignored. A dispatcher that put an image on a shell job meant a
// container, and running the command on the host instead would be the wrong thing done
// quietly — on a machine that was given shell access precisely because it holds
// something a container does not.
func offerExtra(payload map[string]any) Diagnostics {
	executor, _ := payload["executor"].(string)
	_, hasImage := payload["image"]
	switch {
	case executor == "container" && !hasImage:
		return Diagnostics{{Code: CodePayloadFieldMissing, Path: "/payload/image"}}
	case executor == "shell" && hasImage:
		return Diagnostics{{Code: CodePayloadFieldConflict, Path: "/payload/image"}}
	}
	return nil
}

// finishExtra is job.finish's cross-field rule: an outcome that ran has an exit code.
//
// `succeeded` and `failed` are the command's own verdict, so a null exit code under one
// of them is a contradiction rather than a missing field — the key is there, and it says
// the command never ran. `cancelled`, `timed_out` and `errored` may legitimately carry
// null, because there may have been no command to exit.
func finishExtra(payload map[string]any) Diagnostics {
	outcome, _ := payload["outcome"].(string)
	if outcome != "succeeded" && outcome != "failed" {
		return nil
	}
	if value, present := payload["exit_code"]; present && value == nil {
		return Diagnostics{{Code: CodePayloadFieldConflict, Path: "/payload/exit_code"}}
	}
	return nil
}

// logChunkExtra is log.chunk's cross-field rule: the cap is on DECODED bytes, which
// only decoding can answer.
//
// maxLen on `data` bounds the wire form, and it has to, because a receiver must be able
// to refuse an over-long frame without decoding it first. But 43692 base64 characters
// can carry 32769 bytes, one over the ceiling, so the exact cap is checked here — and a
// string that is not base64 at all is a payload type error, not a range one.
func logChunkExtra(payload map[string]any) Diagnostics {
	data, isString := payload["data"].(string)
	if !isString {
		return nil // already reported by the table as a type or missing diagnostic
	}
	size, ok := decodedLen(data)
	if !ok {
		return Diagnostics{{Code: CodePayloadFieldType, Path: "/payload/data"}}
	}
	if size > LogChunkMaxBytes {
		return Diagnostics{{Code: CodePayloadFieldRange, Path: "/payload/data"}}
	}
	return nil
}

// checkObject applies a closed object contract at an RFC 6901 prefix: every required
// field present and legal, and no field the contract does not name.
func checkObject(prefix string, fields []field, obj map[string]any) Diagnostics {
	var diags Diagnostics
	known := make(map[string]bool, len(fields))

	for _, spec := range fields {
		known[spec.name] = true
		path := prefix + "/" + escape(spec.name)
		value, present := obj[spec.name]
		if !present {
			if !spec.optional {
				diags = append(diags, Diagnostic{Code: CodePayloadFieldMissing, Path: path})
			}
			continue
		}
		diags = append(diags, checkValue(path, spec, value)...)
	}

	for key := range obj {
		if !known[key] {
			diags = append(diags, Diagnostic{Code: CodePayloadFieldUnknown, Path: prefix + "/" + escape(key)})
		}
	}
	return diags
}

// checkValue applies one field's contract to one value.
func checkValue(path string, spec field, value any) Diagnostics {
	if value == nil {
		if spec.kinds&kindNull != 0 {
			return nil
		}
		return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
	}

	switch typed := value.(type) {
	case string:
		if spec.kinds&kindString == 0 {
			return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
		}
		return checkString(path, spec, typed)

	case bool:
		if spec.kinds&kindBool == 0 {
			return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
		}
		return nil

	case map[string]any:
		if spec.kinds&kindObject == 0 {
			return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
		}
		return checkMap(path, spec, typed)

	case []any:
		if spec.kinds&kindArray == 0 {
			return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
		}
		return checkArray(path, spec, typed)

	default:
		return checkNumber(path, spec, value)
	}
}

// checkString applies a string field's enum, shape and length.
func checkString(path string, spec field, value string) Diagnostics {
	if len(spec.enum) > 0 && !contains(spec.enum, value) {
		return Diagnostics{{Code: CodePayloadFieldEnum, Path: path}}
	}
	// A value of the right type in the wrong published shape — a job id that is not a
	// job id — is a type error: it is not a value of that shape at all.
	if spec.pattern != nil && !spec.pattern.MatchString(value) {
		return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
	}
	runes := len([]rune(value))
	if (spec.minLen > 0 && runes < spec.minLen) || (spec.maxLen > 0 && runes > spec.maxLen) {
		return Diagnostics{{Code: CodePayloadFieldRange, Path: path}}
	}
	return nil
}

// checkNumber applies a numeric field's integrality and bounds.
func checkNumber(path string, spec field, value any) Diagnostics {
	if spec.kinds&kindInteger != 0 {
		n, isInteger := asInteger(value)
		if !isInteger {
			return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
		}
		return checkBounds(path, spec, float64(n))
	}
	if spec.kinds&kindNumber == 0 {
		return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
	}
	// The only value that reaches here is a json.Number: checkValue has already handled
	// every other JSON type, and the decoder is in UseNumber mode.
	number, ok := value.(json.Number)
	if !ok {
		return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
	}
	f, err := number.Float64()
	if err != nil {
		return Diagnostics{{Code: CodePayloadFieldType, Path: path}}
	}
	return checkBounds(path, spec, f)
}

// checkBounds applies a numeric field's minimum and maximum.
func checkBounds(path string, spec field, value float64) Diagnostics {
	if (spec.min != nil && value < *spec.min) || (spec.max != nil && value > *spec.max) {
		return Diagnostics{{Code: CodePayloadFieldRange, Path: path}}
	}
	return nil
}

// checkMap applies an object field's contract — a closed field list, or an open map
// whose values share one contract.
func checkMap(path string, spec field, value map[string]any) Diagnostics {
	if spec.value != nil {
		var diags Diagnostics
		if spec.maxProps > 0 && len(value) > spec.maxProps {
			diags = append(diags, Diagnostic{Code: CodePayloadFieldRange, Path: path})
		}
		for key, item := range value {
			diags = append(diags, checkValue(path+"/"+escape(key), *spec.value, item)...)
		}
		return diags
	}
	return checkObject(path, spec.fields, value)
}

// checkArray applies an array field's item count and element contract.
func checkArray(path string, spec field, value []any) Diagnostics {
	var diags Diagnostics
	if (spec.minItems > 0 && len(value) < spec.minItems) ||
		(spec.maxItems > 0 && len(value) > spec.maxItems) {
		diags = append(diags, Diagnostic{Code: CodePayloadFieldRange, Path: path})
	}
	if spec.item == nil {
		return diags
	}
	for i, item := range value {
		diags = append(diags, checkValue(path+"/"+strconv.Itoa(i), *spec.item, item)...)
	}
	return diags
}

// contains reports whether a closed set holds a value.
func contains(set []string, value string) bool {
	for _, candidate := range set {
		if candidate == value {
			return true
		}
	}
	return false
}
