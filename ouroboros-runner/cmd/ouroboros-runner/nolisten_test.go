package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The static half of "the agent opens no listening socket".
//
// listen_*_test.go watches a running agent; this reads the source of every package the
// command is built from — its whole dependency closure inside this module — and fails
// on anything that could listen: a net.Listen*, an http.Serve or ListenAndServe, a
// tls.Listen, an http.Server, a ListenConfig. And on the imports that bring a listener in
// by side effect or by design — net/http/pprof, expvar, net/rpc, httptest, and the test
// farm. It is the check that catches the debug endpoint somebody adds "just for now", on
// the pull request that adds it, on every platform.

// modulePath is this module, as go.mod names it.
const modulePath = "github.com/NobuData/ouroboros/ouroboros-runner"

// listeningPackages are the standard packages whose listening API is refused, and the
// selectors in each that listen or serve.
var listeningPackages = map[string]map[string]bool{
	"net": {
		"Listen": true, "ListenTCP": true, "ListenUDP": true, "ListenUnix": true, "ListenUnixgram": true,
		"ListenIP": true, "ListenPacket": true, "ListenMulticastUDP": true, "ListenConfig": true,
		"FileListener": true,
	},
	"net/http": {
		"ListenAndServe": true, "ListenAndServeTLS": true, "Serve": true, "ServeTLS": true, "Server": true,
	},
	"crypto/tls": {"Listen": true, "NewListener": true},
}

// forbiddenImports are packages the agent must not link at all.
var forbiddenImports = map[string]string{
	"net/http/httptest":               "a test server — it listens",
	"net/http/pprof":                  "registers debug handlers, which invite a listener",
	"expvar":                          "registers a debug handler, which invites a listener",
	"net/rpc":                         "an RPC server",
	modulePath + "/internal/farmtest": "the test farm — it listens",
}

// majorVersion is an import path's `/vN` suffix, which is not the package's name.
var majorVersion = regexp.MustCompile(`^v[0-9]+$`)

// TestTheAgentHasNoListeningCode walks the command's dependency closure and holds every
// non-test source file to the rules above.
func TestTheAgentHasNoListeningCode(t *testing.T) {
	root := filepath.Join("..", "..")
	queue := []string{"cmd/ouroboros-runner"}
	visited := map[string]bool{}

	for len(queue) > 0 {
		dir := queue[0]
		queue = queue[1:]
		if visited[dir] {
			continue
		}
		visited[dir] = true

		for _, file := range sourceFiles(t, filepath.Join(root, dir)) {
			imports := map[string]string{}
			for _, spec := range file.syntax.Imports {
				importPath, _ := strconv.Unquote(spec.Path.Value)
				if why, forbidden := forbiddenImports[importPath]; forbidden {
					t.Errorf("%s imports %s: %s", file.name, importPath, why)
				}
				if rest, ours := strings.CutPrefix(importPath, modulePath+"/"); ours {
					queue = append(queue, rest)
				}
				imports[localName(spec, importPath)] = importPath
			}

			ast.Inspect(file.syntax, func(node ast.Node) bool {
				selector, ok := node.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				pkg, ok := selector.X.(*ast.Ident)
				if !ok {
					return true
				}
				if refused := listeningPackages[imports[pkg.Name]]; refused[selector.Sel.Name] {
					t.Errorf("%s: %s.%s — the agent dials, it never listens",
						file.position(selector.Pos()), imports[pkg.Name], selector.Sel.Name)
				}
				return true
			})
		}
	}

	// The walk has to have walked something, or it proves nothing.
	for _, must := range []string{"cmd/ouroboros-runner", "internal/agent", "internal/ws", "internal/enroll", "internal/state"} {
		if !visited[must] {
			t.Errorf("the dependency walk never reached %s", must)
		}
	}
	if visited["internal/farmtest"] {
		t.Error("the command's dependency closure includes the test farm")
	}
}

// TestTheListenerRulesCatchAListener runs the rules over a file that breaks them, so a
// rule that silently stopped matching cannot leave the check above passing for nothing.
func TestTheListenerRulesCatchAListener(t *testing.T) {
	source := `package offender
import (
	"net"
	web "net/http"
	_ "net/http/pprof"
)
func serve() {
	listener, _ := net.Listen("tcp", ":8080")
	_ = web.Serve(listener, nil)
}`
	syntax, err := parser.ParseFile(token.NewFileSet(), "offender.go", source, 0)
	if err != nil {
		t.Fatal(err)
	}

	imports := map[string]string{}
	forbidden := 0
	for _, spec := range syntax.Imports {
		importPath, _ := strconv.Unquote(spec.Path.Value)
		if _, refused := forbiddenImports[importPath]; refused {
			forbidden++
		}
		imports[localName(spec, importPath)] = importPath
	}
	found := 0
	ast.Inspect(syntax, func(node ast.Node) bool {
		if selector, ok := node.(*ast.SelectorExpr); ok {
			if pkg, ok := selector.X.(*ast.Ident); ok && listeningPackages[imports[pkg.Name]][selector.Sel.Name] {
				found++
			}
		}
		return true
	})
	if found != 2 || forbidden != 1 {
		t.Errorf("expected 2 listening calls and 1 forbidden import, found %d and %d", found, forbidden)
	}
}

// sourceFile is one parsed non-test file.
type sourceFile struct {
	name    string
	syntax  *ast.File
	fileSet *token.FileSet
}

// position is a node's file:line, for a failure message.
func (f sourceFile) position(pos token.Pos) string {
	return f.fileSet.Position(pos).String()
}

// sourceFiles parses every non-test Go file in a directory — every platform's, so a
// listener hidden behind a build tag is found too.
func sourceFiles(t *testing.T, dir string) []sourceFile {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	var files []sourceFile
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		fileSet := token.NewFileSet()
		full := filepath.Join(dir, name)
		syntax, err := parser.ParseFile(fileSet, full, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", full, err)
		}
		files = append(files, sourceFile{name: full, syntax: syntax, fileSet: fileSet})
	}
	return files
}

// localName is the name an import is referred to by in its file.
func localName(spec *ast.ImportSpec, importPath string) string {
	if spec.Name != nil {
		return spec.Name.Name
	}
	name := path.Base(importPath)
	if majorVersion.MatchString(name) {
		name = path.Base(path.Dir(importPath))
	}
	return name
}
