import React, { useState, useRef, useEffect } from "react";
import { 
  Upload, 
  Settings, 
  Play, 
  Download, 
  Video, 
  CheckCircle2, 
  XCircle, 
  Info, 
  RefreshCw, 
  Film,
  Layers,
  Clock,
  Terminal as TerminalIcon,
  ChevronRight
} from "lucide-react";

interface Corte {
  id: number;
  arquivo: string;
  inicio: number;
  fim: number;
  duracao: number;
}

interface Cena {
  id: number;
  inicio: number;
  fim: number;
  duracao: number;
}

interface JobStatus {
  id: string;
  originalName: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  stage: "idle" | "scene_detection" | "grouping" | "cutting" | "zipping" | "done";
  progress: number;
  message: string;
  error?: string;
  results?: {
    total_cortes: number;
    cortes: Corte[];
    cenas_originais: Cena[];
  };
}

export default function App() {
  // Estados para gerenciar o upload e arquivo
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // Parâmetros de Configuração
  const [threshold, setThreshold] = useState<number>(27.0);
  const [minDuration, setMinDuration] = useState<number>(60);

  // Estado do Job de processamento
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([
    "ENGINE_READY: Aguardando upload de arquivo...",
    "v0.4.2-alpha - Desenvolvido para cortes de vídeo com FFmpeg Copy-Stream"
  ]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const intervalRef = useRef<any>(null);

  // Adiciona logs ao terminal na tela
  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setTerminalLogs(prev => [`[${time}] ${msg}`, ...prev.slice(0, 25)]);
  };

  // Função para formatar segundos em HH:MM:SS
  const formatTime = (segundos: number): string => {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = Math.floor(segundos % 60);
    const ms = Math.floor((segundos % 1) * 10);
    
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}.${ms}`;
  };

  // Drag & Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("video/") || file.name.endsWith(".mp4") || file.name.endsWith(".mov")) {
        setSelectedFile(file);
        addLog(`Arquivo selecionado via Drop: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
        resetProcessingState();
      } else {
        addLog("Erro: O formato do arquivo deve ser um vídeo (MP4, MOV, MKV).");
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setSelectedFile(file);
      addLog(`Arquivo selecionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`);
      resetProcessingState();
    }
  };

  const resetProcessingState = () => {
    setJobId(null);
    setJobStatus(null);
    setUploadProgress(null);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
  };

  // Executa o upload do vídeo
  const handleUpload = async () => {
    if (!selectedFile) return;

    resetProcessingState();
    addLog(`Iniciando envio de ${selectedFile.name}...`);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("video", selectedFile);

    try {
      // Cria o XMLHttpRequest para podermos acompanhar a porcentagem de upload
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentage = Math.round((event.loaded * 100) / event.total);
          setUploadProgress(percentage);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          setJobId(response.jobId);
          setUploadProgress(null);
          addLog(`Envio concluído com sucesso. ID do Job: ${response.jobId}`);
          
          // Inicializa status do Job
          setJobStatus({
            id: response.jobId,
            originalName: selectedFile.name,
            status: "uploaded",
            stage: "idle",
            progress: 0,
            message: "Pronto para processamento."
          });
        } else {
          if (xhr.status === 413) {
            addLog(`⚠️ [ERRO 413] Arquivo muito grande: O servidor de desenvolvimento limita uploads via HTTP em cerca de 15MB-30MB.`);
            addLog(`👉 SOLUÇÃO: Use um arquivo menor (ex: <15MB) ou clique no botão "Testar com Vídeo de Demonstração (Sem Upload)" logo abaixo para testar todo o fluxo imediatamente com um arquivo fictício de 45MB.`);
          } else {
            addLog(`Erro no envio do arquivo para o servidor: Status ${xhr.status} - ${xhr.statusText || "Sem Detalhes"}. Resposta: ${xhr.responseText || "Sem Resposta"}`);
          }
          setUploadProgress(null);
        }
      });

      xhr.addEventListener("error", () => {
        addLog("Erro de rede durante o upload.");
        setUploadProgress(null);
      });

      xhr.open("POST", "/api/upload");
      xhr.send(formData);

    } catch (err: any) {
      addLog(`Falha ao conectar com a API: ${err.message}`);
      setUploadProgress(null);
    }
  };

  // Carrega e ativa o vídeo de demonstração simulado
  const handleStartDemo = async () => {
    resetProcessingState();
    addLog("Inicializando vídeo de demonstração simulado...");
    try {
      const response = await fetch("/api/upload-demo", {
        method: "POST"
      });
      if (response.ok) {
        const data = await response.json();
        setJobId(data.jobId);
        addLog(`Job de demonstração criado com sucesso. ID: ${data.jobId}`);
        
        // Inicializa o status do job
        setJobStatus({
          id: data.jobId,
          originalName: "video_demonstracao_noticias.mp4",
          status: "uploaded",
          stage: "idle",
          progress: 0,
          message: "Vídeo de demonstração pronto para processamento."
        });

        // Dispara automaticamente o processamento para melhorar a experiência
        setTimeout(async () => {
          addLog("Disparando pipeline de demonstração...");
          try {
            const procResponse = await fetch("/api/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jobId: data.jobId,
                threshold,
                minDuration
              })
            });
            if (procResponse.ok) {
              addLog("Mecanismo de demonstração ativado.");
              
              // Inicia o Polling de Status
              // Passamos a string id do timeout diretamente para atualizar o polling
              if (intervalRef.current) clearInterval(intervalRef.current);
              intervalRef.current = setInterval(async () => {
                try {
                  const statusRes = await fetch(`/api/status/${data.jobId}`);
                  if (statusRes.ok) {
                    const statusData = await statusRes.json();
                    setJobStatus(statusData);

                    // Registra atualizações de status relevantes no terminal
                    if (statusData.message) {
                      addLog(`Etapa [${statusData.stage.toUpperCase()}]: ${statusData.message}`);
                    }

                    if (statusData.status === "completed") {
                      addLog(`✅ Processamento demo finalizado! ${statusData.results?.total_cortes} cortes gerados.`);
                      clearInterval(intervalRef.current);
                    } else if (statusData.status === "failed") {
                      addLog(`❌ Erro no processamento demo: ${statusData.error || "Erro geral"}`);
                      clearInterval(intervalRef.current);
                    }
                  }
                } catch (err: any) {
                  addLog(`Erro ao obter status demo: ${err.message}`);
                }
              }, 1500);
            }
          } catch (procErr: any) {
            addLog(`Erro ao disparar simulação: ${procErr.message}`);
          }
        }, 800);
      } else {
        addLog("Erro ao criar o job de demonstração no servidor.");
      }
    } catch (err: any) {
      addLog(`Falha ao conectar para demonstração: ${err.message}`);
    }
  };

  // Inicia o processamento no backend
  const handleStartProcess = async () => {
    if (!jobId) return;

    addLog(`Disparando pipeline: Threshold=${threshold}s, MinDuration=${minDuration}s`);
    
    try {
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          threshold,
          minDuration
        })
      });

      if (response.ok) {
        addLog("Mecanismo de corte ativado em segundo plano.");
        
        // Inicia o Polling de Status
        startPolling();
      } else {
        const errData = await response.json();
        addLog(`Erro ao iniciar processamento: ${errData.error}`);
      }
    } catch (err: any) {
      addLog(`Erro ao iniciar processo: ${err.message}`);
    }
  };

  // Polling para monitoramento em tempo real
  const startPolling = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(async () => {
      if (!jobId) return;

      try {
        const response = await fetch(`/api/status/${jobId}`);
        if (response.ok) {
          const data: JobStatus = await response.json();
          setJobStatus(data);

          // Registra atualizações de status relevantes no terminal
          if (data.message && (!jobStatus || jobStatus.message !== data.message)) {
            addLog(`Etapa [${data.stage.toUpperCase()}]: ${data.message}`);
          }

          if (data.status === "completed") {
            addLog(`✅ Processamento finalizado! ${data.results?.total_cortes} cortes gerados.`);
            clearInterval(intervalRef.current);
          } else if (data.status === "failed") {
            addLog(`❌ Erro no processamento: ${data.error || "Erro geral"}`);
            clearInterval(intervalRef.current);
          }
        }
      } catch (err: any) {
        addLog(`Erro ao obter status: ${err.message}`);
      }
    }, 1500);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleDownload = () => {
    if (!jobId || jobStatus?.status !== "completed") return;
    addLog("Fazendo download do arquivo .ZIP compactado contendo os cortes...");
    window.location.href = `/api/download/${jobId}`;
  };

  return (
    <div id="news-cutter-container" className="bg-[#0A0A0A] text-white min-h-screen flex flex-col font-sans selection:bg-[#00FF00] selection:text-black">
      {/* Header Section */}
      <header id="header-section" className="p-6 md:p-8 border-b border-white/10 flex flex-col sm:flex-row justify-between items-start sm:items-baseline gap-4 bg-black/40">
        <div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter uppercase leading-none">
            News_Cutter<span className="text-[#00FF00]">.</span>
          </h1>
          <p className="text-xs text-white/40 mt-1 uppercase tracking-widest font-mono">
            Automação de Corte Inteligente de Notícias
          </p>
        </div>
        <div className="text-left sm:text-right font-mono">
          <p className="text-[11px] opacity-60 uppercase tracking-widest">
            Status: <span className={jobStatus?.status === "processing" ? "text-yellow-400 animate-pulse" : "text-[#00FF00]"}>
              {jobStatus ? `● ENGINE_${jobStatus.status.toUpperCase()}` : "● ENGINE_STANDBY"}
            </span>
          </p>
          <p className="text-[10px] opacity-40 uppercase tracking-wider mt-0.5">v0.4.2-alpha | Local Time: 2026</p>
        </div>
      </header>

      {/* Main Content Grid */}
      <main id="main-content-grid" className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 border-b border-white/10">
        
        {/* Left Panel: Upload and Configs */}
        <section id="left-config-panel" className="lg:col-span-5 border-r border-white/10 p-6 md:p-8 flex flex-col bg-[#0d0d0d]/40">
          
          {/* Zona de Drag & Drop */}
          <div 
            id="drag-drop-zone"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 min-h-[220px] md:min-h-[280px] border-2 border-dashed rounded-none flex flex-col items-center justify-center text-center p-6 cursor-pointer group transition-all duration-300 ${
              isDragging 
                ? "border-[#00FF00] bg-[#00FF00]/10" 
                : "border-white/20 hover:border-[#00FF00] bg-white/5 hover:bg-white/10"
            }`}
          >
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="video/*"
              className="hidden" 
            />
            
            <div className="mb-4 p-4 rounded-full bg-white/5 group-hover:bg-[#00FF00]/15 group-hover:scale-110 transition-all duration-300">
              <Upload className={`w-10 h-10 transition-colors ${selectedFile ? "text-[#00FF00]" : "text-white/30 group-hover:text-[#00FF00]"}`} />
            </div>

            {selectedFile ? (
              <div className="space-y-2 max-w-xs">
                <p className="text-lg font-bold text-white uppercase tracking-tight break-all">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-[#00FF00] font-mono uppercase tracking-widest">
                  {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <h2 className="text-xl font-bold uppercase tracking-tight text-white group-hover:text-[#00FF00] transition-colors">
                  Drop News Footage
                </h2>
                <p className="text-xs text-white/40 font-mono">
                  SUPORTA: MP4, MOV, MKV (MÁX 2GB)
                </p>
              </div>
            )}
          </div>

          {/* Opção de Vídeo Demo para testar sem upload */}
          {!jobId && (
            <button
              id="demo-button"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleStartDemo();
              }}
              className="mt-3 w-full bg-transparent text-[#00FF00] border border-[#00FF00]/40 hover:border-[#00FF00] hover:bg-[#00FF00]/5 py-3 px-6 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" /> Testar com Vídeo de Demonstração (Sem Upload)
            </button>
          )}

          {/* Upload Progress Bar se ativo */}
          {uploadProgress !== null && (
            <div id="upload-progress-wrapper" className="mt-4 bg-white/5 p-4 border border-white/10">
              <div className="flex justify-between items-center text-xs font-mono mb-2 uppercase">
                <span className="text-yellow-400">Enviando vídeo ao servidor...</span>
                <span className="font-bold">{uploadProgress}%</span>
              </div>
              <div className="h-2 bg-white/10 w-full overflow-hidden">
                <div 
                  className="h-full bg-[#00FF00] transition-all duration-200" 
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Botão de Envio de Vídeo se selecionado mas sem JobId */}
          {selectedFile && !jobId && uploadProgress === null && (
            <button
              id="upload-button"
              onClick={handleUpload}
              className="mt-4 w-full bg-white text-black py-3 px-6 font-bold text-sm uppercase hover:bg-[#00FF00] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Video className="w-4 h-4" /> Enviar Vídeo para Análise
            </button>
          )}

          {/* Controles de Parâmetros e Configuração */}
          <div id="system-config-section" className="mt-8 space-y-4">
            <div className="flex justify-between items-end">
              <span className="text-xs font-mono uppercase opacity-60 tracking-wider">Parâmetros de Detecção</span>
              <span className="text-[10px] font-mono uppercase bg-[#00FF00]/10 text-[#00FF00] px-2 py-0.5 font-bold">
                FFmpeg copy ativado
              </span>
            </div>

            <div className="bg-white/5 p-5 border border-white/5 space-y-5">
              {/* Slider de Threshold */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono uppercase">
                  <span className="opacity-50">Sensibilidade (Threshold)</span>
                  <span className="text-[#00FF00] font-bold">{threshold.toFixed(1)}</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="50" 
                  step="0.5"
                  value={threshold} 
                  disabled={jobStatus?.status === "processing"}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-full accent-[#00FF00] bg-white/10 h-1.5 cursor-pointer disabled:opacity-40"
                />
                <p className="text-[10px] text-white/40 leading-normal">
                  Valores baixos detectam mudanças sutis de câmera. Valor padrão: <strong className="text-white">27.0</strong>.
                </p>
              </div>

              {/* Input de Duração Mínima */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono uppercase">
                  <span className="opacity-50">Duração Mínima do Clipe</span>
                  <span className="text-[#00FF00] font-bold">{minDuration} segundos</span>
                </div>
                <input 
                  type="range" 
                  min="30" 
                  max="300" 
                  step="10"
                  value={minDuration} 
                  disabled={jobStatus?.status === "processing"}
                  onChange={(e) => setMinDuration(parseInt(e.target.value))}
                  className="w-full accent-[#00FF00] bg-white/10 h-1.5 cursor-pointer disabled:opacity-40"
                />
                <p className="text-[10px] text-white/40 leading-normal">
                  Cenas menores são agrupadas até atingir esta duração. Sobras finais são mescladas ao bloco anterior.
                </p>
              </div>
            </div>

            {/* Ação Primária: Iniciar Processamento */}
            {jobId && jobStatus?.status !== "processing" && jobStatus?.status !== "completed" && (
              <button
                id="start-processing-button"
                onClick={handleStartProcess}
                className="w-full bg-[#00FF00] text-black py-4 px-6 font-black text-lg uppercase hover:bg-white hover:text-black transition-all flex items-center justify-center gap-2 mt-4"
              >
                <Play className="w-5 h-5 fill-current" /> Analisar & Cortar Vídeo
              </button>
            )}

            {/* Estado de Processamento Ativo */}
            {jobStatus?.status === "processing" && (
              <div id="processing-active-box" className="bg-[#00FF00]/5 border border-[#00FF00]/20 p-5 mt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono uppercase text-[#00FF00] flex items-center gap-1.5 animate-pulse">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> {jobStatus.message}
                  </span>
                  <span className="text-xs font-mono font-bold text-[#00FF00]">
                    {Math.round(jobStatus.progress * 100)}%
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 w-full overflow-hidden">
                  <div 
                    className="h-full bg-[#00FF00] transition-all duration-300"
                    style={{ width: `${jobStatus.progress * 100}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono uppercase pt-1 text-white/50">
                  <div>Etapa: <strong className="text-white">{jobStatus.stage}</strong></div>
                  <div className="text-right">Ação: <strong className="text-white">FFmpeg Fast Cut</strong></div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: Processing Queue and Output Visualizer */}
        <section id="right-results-panel" className="lg:col-span-7 bg-[#0f0f0f] p-6 md:p-8 flex flex-col">
          
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
            <h3 className="text-sm font-mono uppercase tracking-[0.2em] border-l-2 border-[#00FF00] pl-3">
              Fila de Cortes (Output Queue)
            </h3>
            
            {/* Indicador de Status Compacto */}
            {jobStatus && (
              <div className="flex items-center gap-2">
                {jobStatus.status === "completed" && (
                  <span className="px-2.5 py-1 bg-[#00FF00] text-black text-[10px] font-bold uppercase tracking-wider">
                    Zip Prontinho para Download
                  </span>
                )}
                {jobStatus.status === "failed" && (
                  <span className="px-2.5 py-1 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider">
                    Erro no Pipeline
                  </span>
                )}
                {jobStatus.status === "processing" && (
                  <span className="px-2.5 py-1 bg-yellow-400 text-black text-[10px] font-bold uppercase tracking-wider animate-pulse">
                    Processando...
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Lista de Resultados / Cortes Gerados */}
          <div id="results-list-container" className="flex-1 space-y-2 overflow-y-auto max-h-[460px] pr-2">
            
            {/* Se houver cortes gerados, renderiza a lista estilizada */}
            {jobStatus?.results?.cortes && jobStatus.results.cortes.length > 0 ? (
              jobStatus.results.cortes.map((corte, index) => (
                <div 
                  key={corte.id} 
                  className="flex items-center justify-between p-4 bg-white/5 border-l-4 border-[#00FF00] hover:bg-white/10 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono text-[#00FF00] flex items-center gap-1 uppercase">
                      <Film className="w-3 h-3" /> NOTICIA_CORTE_{corte.id.toString().padStart(3, "0")}.MP4
                    </div>
                    <div className="text-xl font-black uppercase tracking-tight text-white flex items-center gap-2">
                      <span className="text-white/40 text-xs font-mono font-normal">TIMESTAMPS:</span> 
                      {formatTime(corte.inicio)} 
                      <ChevronRight className="w-4 h-4 text-[#00FF00]" /> 
                      {formatTime(corte.fim)}
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div className="text-[10px] font-mono text-white/40 uppercase">
                      Stream Copied
                    </div>
                    <div className="text-base font-bold text-white font-mono">
                      {corte.duracao.toFixed(1)}s
                    </div>
                  </div>
                </div>
              ))
            ) : jobStatus?.status === "processing" ? (
              // Estado de carregamento simulando cortes sendo gerados ou aguardando
              <div className="space-y-3">
                <div className="p-6 bg-white/5 border border-white/5 flex flex-col items-center justify-center text-center">
                  <RefreshCw className="w-8 h-8 text-[#00FF00] animate-spin mb-3" />
                  <p className="text-sm font-mono uppercase tracking-wider text-white">
                    Analisando Frames do Vídeo
                  </p>
                  <p className="text-xs text-white/40 mt-1 max-w-xs leading-normal">
                    O PySceneDetect está mapeando mudanças de cena através do threshold. O FFmpeg fatiará logo em seguida.
                  </p>
                </div>
                {/* Placeholders industriais */}
                <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 opacity-30 italic font-mono text-xs uppercase">
                  <span>CLIP_001_A.MP4 (Processando...)</span>
                  <span>Aguardando...</span>
                </div>
                <div className="h-14 border-b border-white/5 flex items-center justify-between px-4 opacity-15 italic font-mono text-xs uppercase">
                  <span>CLIP_002_A.MP4 (Aguardando...)</span>
                  <span>Aguardando...</span>
                </div>
              </div>
            ) : (
              // Estado vazio inicial
              <div className="h-full min-h-[250px] border border-dashed border-white/10 flex flex-col items-center justify-center text-center p-8 text-white/40">
                <Video className="w-12 h-12 text-white/10 mb-4" />
                <h4 className="text-sm font-bold uppercase tracking-widest text-white mb-1">Nenhum clipe na fila</h4>
                <p className="text-xs max-w-xs leading-normal font-mono">
                  Selecione um arquivo de notícias à esquerda e ative a engine para extrair os cortes de no mínimo {minDuration} segundos.
                </p>
              </div>
            )}

            {/* Informações detalhadas das Cenas se completado */}
            {jobStatus?.results?.cenas_originais && (
              <div className="mt-6 pt-6 border-t border-white/10">
                <h4 className="text-xs font-mono uppercase tracking-wider text-white/60 mb-3 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#00FF00]" /> Cenas Originais Detectadas ({jobStatus.results.cenas_originais.length})
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {jobStatus.results.cenas_originais.slice(0, 12).map((cena) => (
                    <div key={cena.id} className="bg-white/5 p-2 border border-white/5 font-mono text-[10px] space-y-1">
                      <div className="text-white/40 font-bold uppercase">Cena {cena.id.toString().padStart(2, "0")}</div>
                      <div className="text-white">{cena.duracao.toFixed(1)}s ({cena.inicio.toFixed(1)}s-{cena.fim.toFixed(1)}s)</div>
                    </div>
                  ))}
                  {jobStatus.results.cenas_originais.length > 12 && (
                    <div className="bg-white/5 p-2 border border-white/5 font-mono text-[10px] flex items-center justify-center text-white/40 italic">
                      + {jobStatus.results.cenas_originais.length - 12} cenas adicionais
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Download e Rodapé de Ação */}
          <div id="footer-actions" className="mt-8 pt-6 border-t border-white/10">
            {jobStatus?.status === "completed" ? (
              <button
                id="download-zip-button"
                onClick={handleDownload}
                className="w-full bg-[#00FF00] text-black py-4 px-6 font-black text-xl uppercase hover:bg-white transition-all flex items-center justify-center gap-3 active:scale-[0.98]"
              >
                <Download className="w-6 h-6 stroke-[3]" /> Baixar Pacote ZIP [{jobStatus.results?.total_cortes} Cortes]
              </button>
            ) : (
              <button
                disabled
                className="w-full bg-white/5 text-white/30 py-4 px-6 font-black text-xl uppercase border border-white/5 cursor-not-allowed flex items-center justify-center gap-2"
              >
                Aguardando Conclusão do Processamento
              </button>
            )}
          </div>
        </section>
      </main>

      {/* Terminal / Live Console Logs */}
      <footer id="live-console-logs" className="bg-black p-4 px-6 md:px-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-[10.5px] font-mono border-t border-white/10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[#00FF00] font-bold flex items-center gap-1">
            <TerminalIcon className="w-3.5 h-3.5" /> [CONSOLE LOGS]
          </span>
          <span className="text-white/70 italic truncate max-w-[450px]">
            {terminalLogs[0] || "Mecanismo inicializado."}
          </span>
        </div>
        <div className="flex items-center gap-4 text-white/40 uppercase">
          <span>Python 3.11</span>
          <span>●</span>
          <span>FastAPI Engine</span>
          <span>●</span>
          <span>FFmpeg Copy-Stream</span>
        </div>
      </footer>
    </div>
  );
}
