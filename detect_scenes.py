#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Cortador de Vídeos de Notícias - Etapa 1
Script Python para detecção de cenas e lógica matemática de agrupamento (regra dos 60 segundos).

Este script foca puramente no algoritmo de agrupamento e na detecção lógica de cenas.
Ele inclui um modo de simulação interativo para que você possa validar o comportamento do
algoritmo com cenários hipotéticos antes de realizarmos os cortes físicos na Etapa 2.
"""

import sys
import os
from typing import List, Tuple

# Tenta importar PySceneDetect se disponível (para quando formos analisar arquivos reais)
try:
    from scenedetect import detect, ContentDetector
    SCENEDETECT_AVAILABLE = True
except ImportError:
    SCENEDETECT_AVAILABLE = False


def agrupar_cenas(cenas: List[Tuple[float, float]], min_duracao: float = 60.0) -> List[Tuple[float, float]]:
    """
    Agrupa uma lista de cenas (compostas por início e fim em segundos) em blocos.
    Cada bloco deve acumular cenas até atingir, no mínimo, `min_duracao` segundos.
    Se o último bloco de cenas resultante somar menos que `min_duracao` segundos,
    ele é fundido (anexado) ao bloco imediatamente anterior para evitar clipes muito curtos.
    """
    if not cenas:
        return []

    blocos = []
    bloco_atual_cenas = []

    for i, cena in enumerate(cenas):
        bloco_atual_cenas.append(cena)
        
        # Calcula a duração do bloco acumulado atualmente
        inicio_bloco = bloco_atual_cenas[0][0]
        fim_bloco = bloco_atual_cenas[-1][1]
        duracao_acumulada = fim_bloco - inicio_bloco

        # Se atingiu a duração mínima (ex: 60 segundos), fecha o bloco
        if duracao_acumulada >= min_duracao:
            blocos.append((inicio_bloco, fim_bloco))
            bloco_atual_cenas = []

    # Tratamento de Exceção (A Sobra):
    # Se restaram cenas que não atingiram a duração mínima sozinha no final
    if bloco_atual_cenas:
        inicio_bloco = bloco_atual_cenas[0][0]
        fim_bloco = bloco_atual_cenas[-1][1]
        duracao_restante = fim_bloco - inicio_bloco

        if blocos:
            # Caso especial: Temos blocos anteriores. Funde a sobra com o último bloco.
            inicio_anterior, _ = blocos[-1]
            # Atualiza o último bloco para estender até o final das cenas restantes
            blocos[-1] = (inicio_anterior, fim_bloco)
        else:
            # Se o vídeo inteiro for menor que min_duracao (ex: 45s), gera um único bloco
            blocos.append((inicio_bloco, fim_bloco))

    return blocos


def imprimir_linha_divisoria(char: str = "-", tamanho: int = 70):
    print(char * tamanho)


def demonstrar_acumulo(nome_cenario: str, duracoes_cenas: List[float], min_duracao: float = 60.0):
    """
    Simula e imprime passo a passo no terminal como as cenas são agrupadas.
    """
    imprimir_linha_divisoria("=", 75)
    print(f"🎬 SIMULAÇÃO: {nome_cenario}")
    print(f"Durações das cenas individuais (em segundos): {duracoes_cenas}")
    print(f"Duração mínima exigida por bloco: {min_duracao} segundos")
    imprimir_linha_divisoria("-", 75)

    # Reconstrói os timestamps das cenas a partir das durações individuais
    cenas = []
    tempo_atual = 0.0
    for duracao in duracoes_cenas:
        cenas.append((tempo_atual, tempo_atual + duracao))
        tempo_atual += duracao

    # Passo a passo do processamento matemático do algoritmo
    print("📈 PASSO A PASSO DA ACUMULAÇÃO DE TEMPO:")
    blocos_intermediarios = []
    bloco_atual = []
    acumulador = 0.0
    
    for i, (inicio, fim) in enumerate(cenas):
        duracao = fim - inicio
        acumulador += duracao
        bloco_atual.append(i + 1)
        print(f"  └─ Cena {i+1:02d} ({inicio:5.1f}s -> {fim:5.1f}s) | Duração: {duracao:4.1f}s | Acumulado do Bloco: {acumulador:5.1f}s", end="")
        
        if acumulador >= min_duracao:
            print(f" 🎉 [>= {min_duracao}s! CORTE DEFINIDO]")
            blocos_intermediarios.append((bloco_atual.copy(), acumulador))
            bloco_atual = []
            acumulador = 0.0
        else:
            print(" (Aguardando mais cenas...)")

    # Sobra final
    sobra_detectada = False
    if bloco_atual:
        sobra_detectada = True
        print(f"  ⚠️ Fim das cenas atingido! Sobra no acumulador: {acumulador:.1f}s (Cenas: {bloco_atual})")
        blocos_intermediarios.append((bloco_atual, acumulador))

    print("\n🔍 APLICANDO REGRA DA SOBRA (TRATAMENTO DE EXCEÇÃO):")
    
    # Executa a função real de agrupamento para ver o resultado final
    blocos_finais = agrupar_cenas(cenas, min_duracao)

    if sobra_detectada and len(blocos_intermediarios) > 1:
        sobra_cenas, sobra_dur = blocos_intermediarios[-1]
        print(f"  👉 A sobra final de {sobra_dur:.1f}s é MENOR que o limite de {min_duracao}s.")
        print(f"  👉 Ação: Fundindo as cenas {sobra_cenas} ao bloco anterior para evitar clipe curto.")
    elif sobra_detectada and len(blocos_intermediarios) == 1:
        print(f"  👉 O vídeo inteiro tem apenas {acumulador:.1f}s (menor que o limite de {min_duracao}s).")
        print(f"  👉 Ação: Exportando como um único clipe de curta duração.")
    else:
        print("  👉 Não houve sobra abaixo de 60s ou todos os blocos atenderam o requisito mínimo perfeitamente.")

    print("\n📦 CORTES FINAIS PROPOSTOS:")
    for idx, (inicio, fim) in enumerate(blocos_finais):
        dur_final = fim - inicio
        print(f"  ✂️  Corte {idx+1:02d}: {inicio:6.1f}s até {fim:6.1f}s | Duração Total: {dur_final:5.1f}s")
    
    imprimir_linha_divisoria("=", 75)
    print()


def analisar_video_real(caminho_video: str, threshold: float = 30.0, min_duracao: float = 60.0):
    """
    Carrega um arquivo de vídeo real usando PySceneDetect, mapeia as cenas e executa o algoritmo.
    """
    if not SCENEDETECT_AVAILABLE:
        print("❌ Erro: PySceneDetect não está instalado ou disponível no ambiente Python.")
        print("Por favor, execute: pip install scenedetect opencv-python-headless")
        return

    if not os.path.exists(caminho_video):
        print(f"❌ Erro: Arquivo de vídeo não encontrado em: {caminho_video}")
        return

    print(f"\n🎥 Analisando vídeo real: {caminho_video}")
    print(f"Usando threshold de detecção de conteúdo: {threshold}")
    print("Processando... (Isso pode levar alguns segundos dependendo do tamanho do vídeo)")
    
    # Detecta as cenas utilizando o método ContentDetector (mudança de cenas / cortes secos)
    scene_list = detect(caminho_video, ContentDetector(threshold=threshold))
    
    if not scene_list:
        print("⚠️ Nenhuma mudança de cena detectada. O vídeo será tratado como uma única cena.")
        # Obtém duração total do vídeo de alguma outra forma ou assume uma cena única
        # Por segurança, vamos tratar como vazio se falhar completamente.
        return

    print(f"✅ Detecção concluída! Total de cenas detectadas: {len(scene_list)}")
    
    # Converte os timestamps do PySceneDetect para segundos (float)
    cenas = []
    for i, (inicio_tc, fim_tc) in enumerate(scene_list):
        inicio_s = inicio_tc.get_seconds()
        fim_s = fim_tc.get_seconds()
        duracao = fim_s - inicio_s
        cenas.append((inicio_s, fim_s))
        print(f"  Cena {i+1:02d}: {inicio_s:6.2f}s -> {fim_s:6.2f}s | Duração: {duracao:5.2f}s")

    # Executa o agrupamento com a regra dos 60 segundos
    blocos_finais = agrupar_cenas(cenas, min_duracao)

    print("\n🎯 RESULTADO DO AGRUPAMENTO INTELIGENTE:")
    for idx, (inicio, fim) in enumerate(blocos_finais):
        dur_final = fim - inicio
        print(f"  🎬 Bloco {idx+1:02d}: {inicio:7.2f}s até {fim:7.2f}s | Duração: {dur_final:6.2f}s")


def main():
    print("=========================================================================")
    print("        SISTEMA DE AUTOMAÇÃO DE CORTE DE VÍDEOS DE NOTÍCIAS              ")
    print("                       - ETAPA 1: LÓGICA -                               ")
    print("=========================================================================\n")

    # Verifica se o usuário passou um arquivo de vídeo real por argumento
    if len(sys.argv) > 1:
        caminho_video = sys.argv[1]
        analisar_video_real(caminho_video)
    else:
        print("Nenhum arquivo de vídeo real fornecido como argumento.")
        print("Iniciando a demonstração interativa com os cenários simulados para testar o algoritmo:\n")

        # Cenário 1: Acúmulo padrão com uma sobra final curta que deve ser fundida
        demonstrar_acumulo(
            nome_cenario="Sobra final curta (A Sobra deve fundir-se com o anterior)",
            duracoes_cenas=[15.0, 20.0, 10.0, 25.0, 30.0, 15.0, 20.0], # Total 135s (Bloco 1: 70s, Sobra: 65s -> mas se a sobra no fim fosse menor, ex: 15s+20s)
            min_duracao=60.0
        )

        # Cenário 2: Acúmulo com sobra final muito pequena (Fusão clara)
        demonstrar_acumulo(
            nome_cenario="Fusão Clássica (Sobra de apenas 40 segundos no final)",
            # Vamos usar durações para simular uma sobra que funde:
            duracoes_cenas=[35.0, 30.0, 25.0, 15.0], # Bloco 1: 35+30 = 65s, Sobra: 25+15 = 40s (< 60s, funde!)
            min_duracao=60.0
        )

        # Cenário 3: Vídeo menor que 60 segundos totais
        demonstrar_acumulo(
            nome_cenario="Vídeo Curto (Duração total < 60 segundos)",
            duracoes_cenas=[15.0, 10.0, 20.0], # Total: 45s (< 60s)
            min_duracao=60.0
        )

        print("💡 Para analisar um vídeo real com PySceneDetect, execute:")
        print("   python3 detect_scenes.py <caminho_do_video.mp4>\n")


if __name__ == "__main__":
    main()
