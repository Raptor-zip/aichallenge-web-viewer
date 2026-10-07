---
date: 2026-10-08 08:25:14
phase: "公開"
iteration: 2
status: partial
---

## やろうとしたこと
権限変更後にブラウザ検証とnpm ciを再開した。Chromeの6状態の自動チェックは成功。新規GitHubリポジトリがまだないことを確認した。

## 実際に起きたこと
実際のnpm ciはlockfileの不足を検出し失敗した。前回のoffline dry-runだけでは再現可能なインストールを保証できなかった。完全なnpmログは以下。

```text
0 verbose cli /home/somak/.nvm/versions/node/v24.13.0/bin/node /home/somak/.nvm/versions/node/v24.13.0/bin/npm
1 info using npm@11.6.2
2 info using node@v24.13.0
3 silly config load:file:/home/somak/.nvm/versions/node/v24.13.0/lib/node_modules/npm/npmrc
4 silly config load:file:/home/somak/Autonomous-Driving-AI-Challenge-2026/ksk-web-viewer/.npmrc
5 silly config load:file:/home/somak/.npmrc
6 silly config load:file:/home/somak/.nvm/versions/node/v24.13.0/etc/npmrc
7 verbose title npm ci
8 verbose argv "ci" "--no-audit" "--no-fund"
9 verbose logfile logs-max:10 dir:/home/somak/.npm/_logs/2026-10-07T23_25_14_363Z-
10 verbose logfile /home/somak/.npm/_logs/2026-10-07T23_25_14_363Z-debug-0.log
11 silly logfile start cleaning logs, removing 1 files
12 silly logfile done cleaning log files
13 silly packumentCache heap:4496293888 maxSize:1124073472 maxEntrySize:562036736
14 silly idealTree buildDeps
15 silly fetch manifest @emnapi/core@^2.0.0-alpha.3
16 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fcore cache-miss
17 http fetch GET 200 https://registry.npmjs.org/@emnapi%2fcore 107ms (cache revalidated)
18 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fcore set size:128839 disposed:false
19 silly fetch manifest @emnapi/runtime@^2.0.0-alpha.3
20 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fruntime cache-miss
21 http fetch GET 200 https://registry.npmjs.org/@emnapi%2fruntime 35ms (cache revalidated)
22 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fruntime set size:129467 disposed:false
23 silly placeDep ROOT @emnapi/core@2.0.0-alpha.6 OK for: @napi-rs/wasm-runtime@1.2.0 want: ^2.0.0-alpha.3
24 silly placeDep ROOT @emnapi/runtime@2.0.0-alpha.6 OK for: @napi-rs/wasm-runtime@1.2.0 want: ^2.0.0-alpha.3
25 silly fetch manifest @emnapi/wasi-threads@2.2.0
26 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fwasi-threads cache-miss
27 http fetch GET 200 https://registry.npmjs.org/@emnapi%2fwasi-threads 33ms (cache revalidated)
28 silly packumentCache full:https://registry.npmjs.org/@emnapi%2fwasi-threads set size:37485 disposed:false
29 silly placeDep ROOT @emnapi/wasi-threads@2.2.0 OK for: @emnapi/core@2.0.0-alpha.6 want: 2.2.0
30 silly fetch manifest esbuild@^0.27.0 || ^0.28.0
31 silly packumentCache full:https://registry.npmjs.org/esbuild cache-miss
32 http fetch GET 200 https://registry.npmjs.org/esbuild 23ms (cache revalidated)
33 silly packumentCache full:https://registry.npmjs.org/esbuild set size:1264676 disposed:false
34 silly placeDep node_modules/vite-node esbuild@0.28.2 OK for: vite@8.1.5 want: ^0.27.0 || ^0.28.0
35 silly fetch manifest @esbuild/aix-ppc64@0.28.2
36 silly packumentCache full:https://registry.npmjs.org/@esbuild%2faix-ppc64 cache-miss
37 silly fetch manifest @esbuild/linux-arm@0.28.2
38 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-arm cache-miss
39 silly fetch manifest @esbuild/linux-x64@0.28.2
40 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-x64 cache-miss
41 silly fetch manifest @esbuild/sunos-x64@0.28.2
42 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fsunos-x64 cache-miss
43 silly fetch manifest @esbuild/win32-x64@0.28.2
44 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-x64 cache-miss
45 silly fetch manifest @esbuild/darwin-x64@0.28.2
46 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fdarwin-x64 cache-miss
47 silly fetch manifest @esbuild/linux-ia32@0.28.2
48 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-ia32 cache-miss
49 silly fetch manifest @esbuild/netbsd-x64@0.28.2
50 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fnetbsd-x64 cache-miss
51 silly fetch manifest @esbuild/win32-ia32@0.28.2
52 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-ia32 cache-miss
53 silly fetch manifest @esbuild/android-arm@0.28.2
54 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-arm cache-miss
55 silly fetch manifest @esbuild/android-x64@0.28.2
56 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-x64 cache-miss
57 silly fetch manifest @esbuild/freebsd-x64@0.28.2
58 silly packumentCache full:https://registry.npmjs.org/@esbuild%2ffreebsd-x64 cache-miss
59 silly fetch manifest @esbuild/linux-arm64@0.28.2
60 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-arm64 cache-miss
61 silly fetch manifest @esbuild/linux-ppc64@0.28.2
62 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-ppc64 cache-miss
63 silly fetch manifest @esbuild/linux-s390x@0.28.2
64 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-s390x cache-miss
65 silly fetch manifest @esbuild/openbsd-x64@0.28.2
66 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenbsd-x64 cache-miss
67 silly fetch manifest @esbuild/win32-arm64@0.28.2
68 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-arm64 cache-miss
69 silly fetch manifest @esbuild/darwin-arm64@0.28.2
70 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fdarwin-arm64 cache-miss
71 silly fetch manifest @esbuild/netbsd-arm64@0.28.2
72 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fnetbsd-arm64 cache-miss
73 silly fetch manifest @esbuild/android-arm64@0.28.2
74 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-arm64 cache-miss
75 silly fetch manifest @esbuild/freebsd-arm64@0.28.2
76 silly packumentCache full:https://registry.npmjs.org/@esbuild%2ffreebsd-arm64 cache-miss
77 silly fetch manifest @esbuild/linux-loong64@0.28.2
78 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-loong64 cache-miss
79 silly fetch manifest @esbuild/linux-riscv64@0.28.2
80 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-riscv64 cache-miss
81 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-x64 39ms (cache revalidated)
82 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-x64 set size:198942 disposed:false
83 silly fetch manifest @esbuild/openbsd-arm64@0.28.2
84 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenbsd-arm64 cache-miss
85 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-ppc64 65ms (cache revalidated)
86 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-ppc64 set size:202845 disposed:false
87 silly fetch manifest @esbuild/linux-mips64el@0.28.2
88 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-mips64el cache-miss
89 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-ia32 69ms (cache revalidated)
90 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-ia32 set size:199625 disposed:false
91 silly fetch manifest @esbuild/openharmony-arm64@0.28.2
92 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenharmony-arm64 cache-miss
93 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fnetbsd-x64 72ms (cache revalidated)
94 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fnetbsd-x64 set size:197314 disposed:false
95 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-arm 75ms (cache revalidated)
96 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-arm set size:198596 disposed:false
97 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fdarwin-x64 79ms (cache revalidated)
98 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fdarwin-x64 set size:199670 disposed:false
99 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fwin32-x64 81ms (cache revalidated)
100 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-x64 set size:197540 disposed:false
101 http fetch GET 200 https://registry.npmjs.org/@esbuild%2ffreebsd-x64 84ms (cache revalidated)
102 silly packumentCache full:https://registry.npmjs.org/@esbuild%2ffreebsd-x64 set size:200565 disposed:false
103 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fsunos-x64 85ms (cache revalidated)
104 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fsunos-x64 set size:199187 disposed:false
105 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fopenbsd-x64 85ms (cache revalidated)
106 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenbsd-x64 set size:200576 disposed:false
107 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-s390x 86ms (cache revalidated)
108 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-s390x set size:202310 disposed:false
109 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-arm64 89ms (cache revalidated)
110 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-arm64 set size:200773 disposed:false
111 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fdarwin-arm64 92ms (cache revalidated)
112 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fdarwin-arm64 set size:201471 disposed:false
113 http fetch GET 200 https://registry.npmjs.org/@esbuild%2faix-ppc64 95ms (cache revalidated)
114 silly packumentCache full:https://registry.npmjs.org/@esbuild%2faix-ppc64 set size:67797 disposed:false
115 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fwin32-arm64 95ms (cache revalidated)
116 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-arm64 set size:201005 disposed:false
117 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fandroid-arm 100ms (cache revalidated)
118 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-arm set size:225217 disposed:false
119 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fnetbsd-arm64 101ms (cache revalidated)
120 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fnetbsd-arm64 set size:44308 disposed:false
121 http fetch GET 200 https://registry.npmjs.org/@esbuild%2ffreebsd-arm64 102ms (cache revalidated)
122 silly packumentCache full:https://registry.npmjs.org/@esbuild%2ffreebsd-arm64 set size:202383 disposed:false
123 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fandroid-arm64 105ms (cache revalidated)
124 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-arm64 set size:204216 disposed:false
125 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-mips64el 42ms (cache revalidated)
126 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-mips64el set size:204633 disposed:false
127 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-loong64 110ms (cache revalidated)
128 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-loong64 set size:255749 disposed:false
129 http fetch GET 200 https://registry.npmjs.org/@esbuild%2flinux-riscv64 111ms (cache revalidated)
130 silly packumentCache full:https://registry.npmjs.org/@esbuild%2flinux-riscv64 set size:202512 disposed:false
131 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fopenharmony-arm64 47ms (cache revalidated)
132 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenharmony-arm64 set size:33054 disposed:false
133 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fopenbsd-arm64 77ms (cache revalidated)
134 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fopenbsd-arm64 set size:49642 disposed:false
135 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fandroid-x64 312ms (cache revalidated)
136 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fandroid-x64 set size:199017 disposed:false
137 http fetch GET 200 https://registry.npmjs.org/@esbuild%2fwin32-ia32 314ms (cache revalidated)
138 silly packumentCache full:https://registry.npmjs.org/@esbuild%2fwin32-ia32 set size:199854 disposed:false
139 silly placeDep node_modules/vite-node @esbuild/aix-ppc64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
140 silly placeDep node_modules/vite-node @esbuild/android-arm@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
141 silly placeDep node_modules/vite-node @esbuild/android-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
142 silly placeDep node_modules/vite-node @esbuild/android-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
143 silly placeDep node_modules/vite-node @esbuild/darwin-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
144 silly placeDep node_modules/vite-node @esbuild/darwin-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
145 silly placeDep node_modules/vite-node @esbuild/freebsd-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
146 silly placeDep node_modules/vite-node @esbuild/freebsd-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
147 silly placeDep node_modules/vite-node @esbuild/linux-arm@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
148 silly placeDep node_modules/vite-node @esbuild/linux-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
149 silly placeDep node_modules/vite-node @esbuild/linux-ia32@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
150 silly placeDep node_modules/vite-node @esbuild/linux-loong64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
151 silly placeDep node_modules/vite-node @esbuild/linux-mips64el@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
152 silly placeDep node_modules/vite-node @esbuild/linux-ppc64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
153 silly placeDep node_modules/vite-node @esbuild/linux-riscv64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
154 silly placeDep node_modules/vite-node @esbuild/linux-s390x@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
155 silly placeDep node_modules/vite-node @esbuild/linux-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
156 silly placeDep ROOT @esbuild/netbsd-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
157 silly placeDep node_modules/vite-node @esbuild/netbsd-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
158 silly placeDep ROOT @esbuild/openbsd-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
159 silly placeDep node_modules/vite-node @esbuild/openbsd-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
160 silly placeDep ROOT @esbuild/openharmony-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
161 silly placeDep node_modules/vite-node @esbuild/sunos-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
162 silly placeDep node_modules/vite-node @esbuild/win32-arm64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
163 silly placeDep node_modules/vite-node @esbuild/win32-ia32@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
164 silly placeDep node_modules/vite-node @esbuild/win32-x64@0.28.2 OK for: esbuild@0.28.2 want: 0.28.2
165 verbose stack Error: 
165 verbose stack `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
165 verbose stack
165 verbose stack Missing: @emnapi/wasi-threads@2.2.0 from lock file
165 verbose stack Missing: @esbuild/aix-ppc64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/android-arm@0.28.2 from lock file
165 verbose stack Missing: @esbuild/android-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/android-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/darwin-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/darwin-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/freebsd-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/freebsd-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-arm@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-ia32@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-loong64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-mips64el@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-ppc64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-riscv64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-s390x@0.28.2 from lock file
165 verbose stack Missing: @esbuild/linux-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/netbsd-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/netbsd-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/openbsd-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/openbsd-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/openharmony-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/sunos-x64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/win32-arm64@0.28.2 from lock file
165 verbose stack Missing: @esbuild/win32-ia32@0.28.2 from lock file
165 verbose stack Missing: @esbuild/win32-x64@0.28.2 from lock file
165 verbose stack
165 verbose stack Clean install a project
165 verbose stack
165 verbose stack Usage:
165 verbose stack npm ci
165 verbose stack
165 verbose stack Options:
165 verbose stack [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
165 verbose stack [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
165 verbose stack [--include <prod|dev|optional|peer> [--include <prod|dev|optional|peer> ...]]
165 verbose stack [--strict-peer-deps] [--foreground-scripts] [--ignore-scripts] [--no-audit]
165 verbose stack [--no-bin-links] [--no-fund] [--dry-run]
165 verbose stack [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
165 verbose stack [--workspaces] [--include-workspace-root] [--install-links]
165 verbose stack
165 verbose stack aliases: clean-install, ic, install-clean, isntall-clean
165 verbose stack
165 verbose stack Run "npm help ci" for more info
165 verbose stack     at CI.usageError (/home/somak/.nvm/versions/node/v24.13.0/lib/node_modules/npm/lib/base-cmd.js:111:26)
165 verbose stack     at CI.exec (/home/somak/.nvm/versions/node/v24.13.0/lib/node_modules/npm/lib/commands/ci.js:70:18)
165 verbose stack     at async Npm.exec (/home/somak/.nvm/versions/node/v24.13.0/lib/node_modules/npm/lib/npm.js:208:9)
165 verbose stack     at async module.exports (/home/somak/.nvm/versions/node/v24.13.0/lib/node_modules/npm/lib/cli/entry.js:67:5)
166 error code EUSAGE
167 error
167 error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
167 error
167 error Missing: @emnapi/wasi-threads@2.2.0 from lock file
167 error Missing: @esbuild/aix-ppc64@0.28.2 from lock file
167 error Missing: @esbuild/android-arm@0.28.2 from lock file
167 error Missing: @esbuild/android-arm64@0.28.2 from lock file
167 error Missing: @esbuild/android-x64@0.28.2 from lock file
167 error Missing: @esbuild/darwin-arm64@0.28.2 from lock file
167 error Missing: @esbuild/darwin-x64@0.28.2 from lock file
167 error Missing: @esbuild/freebsd-arm64@0.28.2 from lock file
167 error Missing: @esbuild/freebsd-x64@0.28.2 from lock file
167 error Missing: @esbuild/linux-arm@0.28.2 from lock file
167 error Missing: @esbuild/linux-arm64@0.28.2 from lock file
167 error Missing: @esbuild/linux-ia32@0.28.2 from lock file
167 error Missing: @esbuild/linux-loong64@0.28.2 from lock file
167 error Missing: @esbuild/linux-mips64el@0.28.2 from lock file
167 error Missing: @esbuild/linux-ppc64@0.28.2 from lock file
167 error Missing: @esbuild/linux-riscv64@0.28.2 from lock file
167 error Missing: @esbuild/linux-s390x@0.28.2 from lock file
167 error Missing: @esbuild/linux-x64@0.28.2 from lock file
167 error Missing: @esbuild/netbsd-arm64@0.28.2 from lock file
167 error Missing: @esbuild/netbsd-x64@0.28.2 from lock file
167 error Missing: @esbuild/openbsd-arm64@0.28.2 from lock file
167 error Missing: @esbuild/openbsd-x64@0.28.2 from lock file
167 error Missing: @esbuild/openharmony-arm64@0.28.2 from lock file
167 error Missing: @esbuild/sunos-x64@0.28.2 from lock file
167 error Missing: @esbuild/win32-arm64@0.28.2 from lock file
167 error Missing: @esbuild/win32-ia32@0.28.2 from lock file
167 error Missing: @esbuild/win32-x64@0.28.2 from lock file
167 error
167 error Clean install a project
167 error
167 error Usage:
167 error npm ci
167 error
167 error Options:
167 error [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
167 error [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
167 error [--include <prod|dev|optional|peer> [--include <prod|dev|optional|peer> ...]]
167 error [--strict-peer-deps] [--foreground-scripts] [--ignore-scripts] [--no-audit]
167 error [--no-bin-links] [--no-fund] [--dry-run]
167 error [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
167 error [--workspaces] [--include-workspace-root] [--install-links]
167 error
167 error aliases: clean-install, ic, install-clean, isntall-clean
167 error
167 error Run "npm help ci" for more info
168 verbose cwd /home/somak/Autonomous-Driving-AI-Challenge-2026/ksk-web-viewer
169 verbose os Linux 6.18.6-1-liquorix-amd64
170 verbose node v24.13.0
171 verbose npm  v11.6.2
172 verbose exit 1
173 verbose code 1
174 error A complete log of this run can be found in: /home/somak/.npm/_logs/2026-10-07T23_25_14_363Z-debug-0.log
```

## 原因
vite-node 6がVite 8と新しいesbuild/WASIを別途依存として取り込み、ロックにはそのoptional依存が不足している。npm view vite-node@2.1.9 dependenciesで、使用中のVite 5と同じ世代に合わせられることを確認した。

## 試して却下した方法
offlineのlockfile更新とdry-runだけによる判定。実際のnpm ciが失敗したため不十分。

## 最終的な対応
vite-nodeをVite 5に対応する2.1.9へ合わせ、使っていないWASM関連の直接依存を除く。オンラインでlockfileを再生成し、実際のnpm ci・テスト・ビルド・画面確認を実施してから公開する。

## 次にやる人が知っておくべきこと
前回の公開未完了状態は6385487。今回はGitHubとChromeの権限制限が解除されている。実車ROS接続はこの環境では実行しない。
