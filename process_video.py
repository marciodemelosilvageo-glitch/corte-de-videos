#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Cortador de Vídeos de Notícias - Etapa 2 & 3
Script Python integrado para detecção de cenas, agrupamento lógico, corte físico ultra-rápido com FFmpeg e criação do arquivo ZIP.

Este script é chamado pelo backend Express para processar o vídeo enviado pelo usuário.
Retorna logs estruturados em JSON para facilitar a comunicação com o front-end.
"""

import sys
import os
import json
import subprocess
import zipfile
import shutil
from typing import List, Tuple

try:
    from scenedetect import detect, ContentDetector
    SCENEDETECT_AVAILABLE = True
except ImportError:
    SCENEDETECT_AVAILABLE = False


def agrupar_cenas(cenas: List[Tuple[float, float]], min_duracao: float = 60.0) -> List[Tuple[float, float]]:
    """
    Agrupa as cenas garantindo que cada bloco tenha pelo menos `min_duracao` segundos.
    Se o último bloco for menor que o limite, ele é fundido ao bloco anterior.
    """
    if not cenas:
        return []

    blocos = []
    bloco_atual_cenas = []

    for cena in cenas:
        bloco_atual_cenas.append(cena)
        
        inicio_bloco = bloco_atual_cenas[0][0]
        fim_bloco = bloco_atual_cenas[-1][1]
        duracao_acumulada = fim_bloco - inicio_bloco

        if duracao_acumulada >= min_duracao:
            blocos.append((inicio_bloco, fim_bloco))
            bloco_atual_cenas = []

    # Tratamento de Exceção (A Sobra)
    if bloco_atual_cenas:
        inicio_bloco = bloco_atual_cenas[0][0]
        fim_bloco = bloco_atual_cenas[-1][1]

        if blocos:
            # Funde com o bloco anterior
            inicio_anterior, _ = blocos[-1]
            blocos[-1] = (inicio_anterior, fim_bloco)
        else:
            # Vídeo inteiro é menor que 60 segundos
            blocos.append((inicio_bloco, fim_bloco))

    return blocos


def cortar_video_ffmpeg(video_entrada: str, caminho_saida: str, inicio: float, fim: float) -> bool:
    """
    Executa o corte físico do vídeo usando FFmpeg via Stream Copy (-c copy),
    garantindo velocidade máxima e sem perda de qualidade.
    """
    duracao = fim - inicio
    
    # Comando FFmpeg otimizado para corte rápido sem re-encode
    # Usamos -ss antes do -i para busca rápida (fast seek) de keyframe
    # e -avoid_negative_ts make_zero para garantir compatibilidade de áudio/vídeo
    comando = [
        "ffmpeg",
        "-y",                 # Sobrescrever arquivo de saída se existir
        "-ss", f"{inicio:.3f}",
        "-t", f"{duracao:.3f}",
        "-i", video_entrada,
        "-c", "copy",         # Copiar fluxos diretamente (sem re-renderização)
        "-avoid_negative_ts", "make_zero",
        caminho_saida
    ]
    
    try:
        # Executa o comando de forma silenciosa
        resultado = subprocess.run(
            comando,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
        return True
    except subprocess.CalledProcessError as e:
        sys.stderr.write(f"Erro no FFmpeg ao cortar de {inicio}s a {fim}s:\n{e.stderr}\n")
        return False


def main():
    if len(sys.argv) < 3:
        resultado_erro = {
            "status": "error",
            "message": "Uso correto: python3 process_video.py <caminho_video_entrada> <diretorio_trabalho> [threshold] [min_duracao]"
        }
        print(json.dumps(resultado_erro, indent=2))
        sys.exit(1)

    video_entrada = sys.argv[1]
    diretorio_trabalho = sys.argv[2]
    
    threshold = 27.0
    if len(sys.argv) > 3:
        try:
            threshold = float(sys.argv[3])
        except ValueError:
            pass

    min_duracao = 60.0
    if len(sys.argv) > 4:
        try:
            min_duracao = float(sys.argv[4])
        except ValueError:
            pass

    if not os.path.exists(video_entrada):
        print(json.dumps({
            "status": "error",
            "message": f"Arquivo de vídeo não encontrado: {video_entrada}"
        }))
        sys.exit(1)

    # Cria diretório de trabalho se não existir
    os.makedirs(diretorio_trabalho, exist_ok=True)
    diretorio_cortes = os.path.join(diretorio_trabalho, "cortes")
    os.makedirs(diretorio_cortes, exist_ok=True)

    # 1. Detecção de cenas
    # Imprime progresso intermediário estruturado para leitura do backend Node
    print(json.dumps({"status": "progress", "stage": "scene_detection", "message": "Iniciando detecção de cenas..."}))
    
    cenas = []
    if SCENEDETECT_AVAILABLE:
        try:
            scene_list = detect(video_entrada, ContentDetector(threshold=threshold))
            for i, (inicio_tc, fim_tc) in enumerate(scene_list):
                cenas.append((inicio_tc.get_seconds(), fim_tc.get_seconds()))
        except Exception as e:
            # Fallback caso falhe por algum motivo do codec
            sys.stderr.write(f"Falha na detecção automática: {str(e)}\n")
    
    # Se PySceneDetect não retornou nada ou não está disponível, simula uma cena única para o vídeo todo
    if not cenas:
        # Obtém a duração total usando ffprobe
        try:
            comando_ffprobe = [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nocey=1", video_entrada
            ]
            # Algumas versões de ffprobe usam "nocey" ou "nokey"
            comando_ffprobe = [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", video_entrada
            ]
            duracao_total = float(subprocess.check_output(comando_ffprobe).decode().strip())
            cenas = [(0.0, duracao_total)]
        except Exception:
            # Fallback definitivo de 120 segundos se tudo falhar
            cenas = [(0.0, 120.0)]

    print(json.dumps({
        "status": "progress", 
        "stage": "grouping", 
        "message": f"Detecção concluída. {len(cenas)} cenas mapeadas. Aplicando agrupamento de {min_duracao}s..."
    }))

    # 2. Agrupamento de cenas
    blocos = agrupar_cenas(cenas, min_duracao)

    # 3. Execução dos cortes físicos via FFmpeg
    print(json.dumps({
        "status": "progress", 
        "stage": "cutting", 
        "message": f"Iniciando {len(blocos)} cortes físicos com FFmpeg..."
    }))

    arquivos_cortados = []
    for idx, (inicio, fim) in enumerate(blocos):
        nome_arquivo = f"noticia_corte_{idx+1:03d}.mp4"
        caminho_corte = os.path.join(diretorio_cortes, nome_arquivo)
        
        sucesso = cortar_video_ffmpeg(video_entrada, caminho_corte, inicio, fim)
        if sucesso:
            arquivos_cortados.append({
                "id": idx + 1,
                "arquivo": nome_arquivo,
                "inicio": inicio,
                "fim": fim,
                "duracao": fim - inicio
            })
            print(json.dumps({
                "status": "progress",
                "stage": "cutting_progress",
                "progress": (idx + 1) / len(blocos),
                "message": f"Corte {idx+1}/{len(blocos)} concluído ({nome_arquivo})"
            }))

    # 4. Compactação em arquivo ZIP
    caminho_zip = os.path.join(diretorio_trabalho, "noticias_cortadas.zip")
    print(json.dumps({"status": "progress", "stage": "zipping", "message": "Compactando cortes em arquivo ZIP..."}))
    
    try:
        with zipfile.ZipFile(caminho_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for item in arquivos_cortados:
                caminho_completo = os.path.join(diretorio_cortes, item["arquivo"])
                zipf.write(caminho_completo, item["arquivo"])
        
        # Limpa os arquivos de cortes individuais após criar o ZIP para liberar espaço
        shutil.rmtree(diretorio_cortes, ignore_errors=True)
        
        # Retorna o resultado final de sucesso com metadados detalhados
        resultado_final = {
            "status": "success",
            "zip_path": caminho_zip,
            "total_cortes": len(arquivos_cortados),
            "cortes": arquivos_cortados,
            "cenas_originais": [{"id": i+1, "inicio": c[0], "fim": c[1], "duracao": c[1]-c[0]} for i, c in enumerate(cenas)]
        }
        print(json.dumps(resultado_final, indent=2))

    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": f"Erro ao criar arquivo ZIP: {str(e)}"
        }))


if __name__ == "__main__":
    main()
