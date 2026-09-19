package telemetry

// platformSources reads this Mac: CPU from top, memory from sysctl.
func platformSources() sources { return sources{cpu: topCPU, memory: sysctlMemory} }
