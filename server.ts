import express from "express";
import path from "path";
import fs from "fs";
import { spawn, execSync } from "child_process";
import multer from "multer";
import { createServer as createViteServer } from "vite";

// Define a estrutura do Job em memória
interface Job {
  id: string;
  originalName: string;
  videoPath: string;
  workDir: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  stage: "idle" | "scene_detection" | "grouping" | "cutting" | "zipping" | "done";
  progress: number;
  message: string;
  zipPath?: string;
  error?: string;
  results?: {
    total_cortes: number;
    cortes: Array<{
      id: number;
      arquivo: string;
      inicio: number;
      fim: number;
      duracao: number;
    }>;
    cenas_originais: Array<{
      id: number;
      inicio: number;
      fim: number;
      duracao: number;
    }>;
  };
}

// Armazena os jobs em memória
const jobs: Record<string, Job> = {};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Garante a existência do diretório temporário para uploads e processamento
  const BASE_TEMP_DIR = path.join(process.cwd(), "temp_news_cutter");
  if (!fs.existsSync(BASE_TEMP_DIR)) {
    fs.mkdirSync(BASE_TEMP_DIR, { recursive: true });
  }

  // Configuração do Multer para Uploads
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(BASE_TEMP_DIR, "uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `video-${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 2 * 1024 * 1024 * 1024 // Limite de 2GB por vídeo de notícias
    }
  });

  // --- ROTAS DA API ---

  // Rota de Healthcheck
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", engine: "News_Cutter v0.4.2-alpha" });
  });

  // 1. Upload de vídeo
  app.post("/api/upload", (req, res, next) => {
    upload.single("video")(req, res, (err) => {
      if (err) {
        console.error("Erro do Multer no upload:", err);
        return res.status(400).json({ error: `Erro no upload: ${err.message}` });
      }
      next();
    });
  }, (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Nenhum arquivo enviado ou formato inválido." });
        return;
      }

      const jobId = "job_" + Date.now() + "_" + Math.round(Math.random() * 1000);
      const workDir = path.join(BASE_TEMP_DIR, jobId);
      fs.mkdirSync(workDir, { recursive: true });

      // Registra o Job em memória
      jobs[jobId] = {
        id: jobId,
        originalName: req.file.originalname,
        videoPath: req.file.path,
        workDir,
        status: "uploaded",
        stage: "idle",
        progress: 0,
        message: "Vídeo enviado com sucesso. Pronto para processamento.",
      };

      res.json({
        jobId,
        fileName: req.file.originalname,
        size: req.file.size,
        status: "uploaded"
      });
    } catch (err: any) {
      console.error("Erro no upload:", err);
      res.status(500).json({ error: "Falha interna no servidor ao fazer upload do vídeo." });
    }
  });

  // 1b. Upload Simulado de Demonstração (Fallback)
  app.post("/api/upload-demo", (req, res) => {
    try {
      const jobId = "job_demo_" + Date.now();
      const workDir = path.join(BASE_TEMP_DIR, jobId);
      fs.mkdirSync(workDir, { recursive: true });

      // Registra o Job de demonstração
      jobs[jobId] = {
        id: jobId,
        originalName: "video_demonstracao_noticias.mp4",
        videoPath: "DEMO_MODE",
        workDir,
        status: "uploaded",
        stage: "idle",
        progress: 0,
        message: "Vídeo de demonstração carregado. Pronto para análise.",
      };

      res.json({
        jobId,
        fileName: "video_demonstracao_noticias.mp4",
        size: 45 * 1024 * 1024, // 45MB simulados
        status: "uploaded"
      });
    } catch (err: any) {
      res.status(500).json({ error: "Falha ao criar job de demonstração." });
    }
  });

  // 2. Iniciar Processamento do Vídeo
  app.post("/api/process", (req, res) => {
    const { jobId, threshold = 27.0, minDuration = 60.0 } = req.body;

    if (!jobId || !jobs[jobId]) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }

    const job = jobs[jobId];
    if (job.status === "processing") {
      res.status(400).json({ error: "O vídeo já está sendo processado." });
      return;
    }

    if (job.videoPath === "DEMO_MODE") {
      // Simulação de processamento para demonstração sem upload real
      job.status = "processing";
      job.stage = "scene_detection";
      job.progress = 0.1;
      job.message = "Detectando cortes de cena no vídeo demo...";

      let step = 0;
      const interval = setInterval(() => {
        step++;
        if (step === 1) {
          job.stage = "grouping";
          job.progress = 0.3;
          job.message = "Agrupando cenas para garantir blocos >= 60 segundos...";
        } else if (step === 2) {
          job.stage = "cutting";
          job.progress = 0.5;
          job.message = "Cortando fisicamente o vídeo com FFmpeg Copy-Stream (Corte 1/2)...";
        } else if (step === 3) {
          job.progress = 0.7;
          job.message = "Cortando fisicamente o vídeo com FFmpeg Copy-Stream (Corte 2/2)...";
        } else if (step === 4) {
          job.stage = "zipping";
          job.progress = 0.9;
          job.message = "Compactando os cortes finais no arquivo ZIP...";
          
          try {
            const zipPath = path.join(job.workDir, "noticias_cortadas.zip");
            // Executa comando Python em uma linha para gerar o arquivo ZIP real com arquivos fictícios
            execSync(`python3 -c "import zipfile, os; f=zipfile.ZipFile('${zipPath}', 'w'); f.writestr('noticia_corte_001.mp4', 'Video Simulado - Bloco 1 (Duração: 72.4s)'); f.writestr('noticia_corte_002.mp4', 'Video Simulado - Bloco 2 (Duração: 72.7s)'); f.close()"`);
            
            job.zipPath = zipPath;
          } catch (zipErr) {
            console.error("Erro ao gerar ZIP simulado:", zipErr);
          }
        } else if (step === 5) {
          job.status = "completed";
          job.stage = "done";
          job.progress = 1.0;
          job.message = "Mecanismo concluído! ZIP pronto para download.";
          job.results = {
            total_cortes: 2,
            cortes: [
              { id: 1, arquivo: "noticia_corte_001.mp4", inicio: 0.0, fim: 72.4, duracao: 72.4 },
              { id: 2, arquivo: "noticia_corte_002.mp4", inicio: 72.4, fim: 145.1, duracao: 72.7 }
            ],
            cenas_originais: [
              { id: 1, inicio: 0.0, fim: 15.2, duracao: 15.2 },
              { id: 2, inicio: 15.2, fim: 42.1, duracao: 26.9 },
              { id: 3, inicio: 42.1, fim: 72.4, duracao: 30.3 },
              { id: 4, inicio: 72.4, fim: 110.0, duracao: 37.6 },
              { id: 5, inicio: 110.0, fim: 145.1, duracao: 35.1 }
            ]
          };
          clearInterval(interval);
        }
      }, 1500);

      res.json({ status: "started", jobId });
      return;
    }

    // Altera o status para Processando
    job.status = "processing";
    job.stage = "scene_detection";
    job.progress = 0.05;
    job.message = "Inicializando mecanismo de detecção de cenas...";

    // Dispara o script Python em segundo plano
    const pythonScript = path.join(process.cwd(), "process_video.py");
    const pyProcess = spawn("python3", [
      pythonScript,
      job.videoPath,
      job.workDir,
      threshold.toString(),
      minDuration.toString()
    ]);

    let stdoutData = "";

    pyProcess.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed.status === "progress") {
            // Atualiza o progresso do job em tempo real
            job.stage = parsed.stage || job.stage;
            job.message = parsed.message || job.message;
            if (parsed.progress !== undefined) {
              job.progress = 0.2 + parsed.progress * 0.7; // Mapeia o corte físico de 20% a 90%
            } else if (parsed.stage === "scene_detection") {
              job.progress = 0.1;
            } else if (parsed.stage === "grouping") {
              job.progress = 0.2;
            } else if (parsed.stage === "zipping") {
              job.progress = 0.9;
            }
          } else if (parsed.status === "success") {
            job.status = "completed";
            job.stage = "done";
            job.progress = 1.0;
            job.message = "Vídeo processado e compactado com sucesso!";
            job.zipPath = parsed.zip_path;
            job.results = {
              total_cortes: parsed.total_cortes,
              cortes: parsed.cortes,
              cenas_originais: parsed.cenas_originais
            };
          } else if (parsed.status === "error") {
            job.status = "failed";
            job.message = parsed.message || "Erro desconhecido no processador de vídeo.";
            job.error = parsed.message;
          }
        } catch (e) {
          // Se não for JSON, acumula como string comum para depuração
          stdoutData += line + "\n";
        }
      }
    });

    pyProcess.stderr.on("data", (data) => {
      console.error(`[Python Err - ${jobId}]:`, data.toString());
    });

    pyProcess.on("close", (code) => {
      if (code !== 0 && job.status === "processing") {
        job.status = "failed";
        job.message = "Processo Python finalizado abruptamente.";
        job.error = stdoutData || "Erro de execução de subprocesso.";
      }
      
      // Apaga o vídeo original enviado para poupar espaço
      try {
        if (fs.existsSync(job.videoPath)) {
          fs.unlinkSync(job.videoPath);
        }
      } catch (err) {
        console.error("Erro ao apagar vídeo original:", err);
      }
    });

    res.json({ status: "started", jobId });
  });

  // 3. Obter status do Job (Polling)
  app.get("/api/status/:jobId", (req, res) => {
    const { jobId } = req.params;
    if (!jobId || !jobs[jobId]) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    const job = jobs[jobId];
    res.json({
      id: job.id,
      originalName: job.originalName,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      message: job.message,
      error: job.error,
      results: job.results
    });
  });

  // 4. Download do ZIP final
  app.get("/api/download/:jobId", (req, res) => {
    const { jobId } = req.params;
    if (!jobId || !jobs[jobId]) {
      res.status(404).json({ error: "Download expirado ou job não encontrado." });
      return;
    }

    const job = jobs[jobId];
    if (job.status !== "completed" || !job.zipPath || !fs.existsSync(job.zipPath)) {
      res.status(400).json({ error: "O arquivo ZIP de cortes ainda não está pronto para download." });
      return;
    }

    const downloadName = `${path.basename(job.originalName, path.extname(job.originalName))}_cortes.zip`;
    
    // Faz o envio do arquivo
    res.download(job.zipPath, downloadName, (err) => {
      if (err) {
        console.error("Erro no download:", err);
      } else {
        // Exclui a pasta temporária de trabalho após o download com um delay curto para evitar travar o fluxo
        setTimeout(() => {
          try {
            if (fs.existsSync(job.workDir)) {
              fs.rmSync(job.workDir, { recursive: true, force: true });
            }
            delete jobs[jobId];
          } catch (deleteErr) {
            console.error("Erro ao limpar pasta de trabalho:", deleteErr);
          }
        }, 10000);
      }
    });
  });

  // Configuração automática para servir o front-end React / Vite
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Monitor e limpeza de diretórios temporários antigos para evitar discos cheios (roda a cada 1 hora)
  setInterval(() => {
    const limiarTempo = Date.now() - 2 * 60 * 60 * 1000; // Limpa se tiver mais de 2 horas
    Object.keys(jobs).forEach((id) => {
      const job = jobs[id];
      const tempoCriacao = parseInt(id.split("_")[1]) || 0;
      if (tempoCriacao < limiarTempo) {
        try {
          if (fs.existsSync(job.workDir)) {
            fs.rmSync(job.workDir, { recursive: true, force: true });
          }
          if (fs.existsSync(job.videoPath)) {
            fs.unlinkSync(job.videoPath);
          }
        } catch (err) {
          console.error("Erro na limpeza automática de arquivos órfãos:", err);
        }
        delete jobs[id];
      }
    });
  }, 60 * 60 * 1000);

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
