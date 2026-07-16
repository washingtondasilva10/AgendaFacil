function limparNumero(numero) {
  const digitos = String(numero || '').replace(/\D/g, '');
  if (!digitos) return '';
  if ((digitos.length === 10 || digitos.length === 11) && !digitos.startsWith('55')) return `55${digitos}`;
  return digitos;
}

function formatarDataBR(data) {
  const partes = String(data || '').substring(0, 10).split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(data || '');
}

function formatarValor(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parametroTexto(texto) {
  return { type: 'text', text: String(texto ?? '') || '-' };
}

function obterConfiguracao() {
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    wabaId: process.env.WHATSAPP_WABA_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0'
  };
}

function statusConfiguracao() {
  const config = obterConfiguracao();
  return {
    configurado: Boolean(config.token && config.phoneNumberId),
    phoneNumberIdConfigurado: Boolean(config.phoneNumberId),
    wabaIdConfigurado: Boolean(config.wabaId),
    tokenConfigurado: Boolean(config.token),
    apiVersion: config.apiVersion
  };
}


async function resolverTemplateMeta(nomePreferido, idiomaPreferido) {
  const { token, wabaId, apiVersion } = obterConfiguracao();
  const nome = String(nomePreferido || '').trim();
  const idioma = String(idiomaPreferido || 'pt_BR').trim();

  if (!token || !wabaId || !nome) {
    return { nome, idioma };
  }

  try {
    const url = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`);
    url.searchParams.set('name', nome);
    url.searchParams.set('fields', 'name,status,language');
    url.searchParams.set('limit', '100');

    const resposta = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000)
    });
    const dados = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      console.warn('[WhatsApp] Não foi possível consultar o template no WABA:', JSON.stringify(dados));
      return { nome, idioma };
    }

    const templates = Array.isArray(dados?.data) ? dados.data : [];
    const ativo = templates.find((item) =>
      String(item?.name || '') === nome &&
      String(item?.status || '').toUpperCase() === 'APPROVED' &&
      String(item?.language || '') === idioma
    ) || templates.find((item) =>
      String(item?.name || '') === nome &&
      String(item?.status || '').toUpperCase() === 'APPROVED'
    ) || templates.find((item) => String(item?.name || '') === nome);

    if (!ativo) {
      console.error(`[WhatsApp] Template ${nome} não encontrado no WABA ${wabaId}.`);
      return { nome, idioma };
    }

    const resolvido = {
      nome: String(ativo.name || nome),
      idioma: String(ativo.language || idioma)
    };
    console.log('[WhatsApp] Template resolvido no WABA:', resolvido);
    return resolvido;
  } catch (erro) {
    console.warn('[WhatsApp] Falha ao resolver template automaticamente:', erro.message);
    return { nome, idioma };
  }
}

async function enviarPayloadWhatsApp({ numero, payload }) {
  const { token, phoneNumberId, apiVersion } = obterConfiguracao();
  if (!token || !phoneNumberId) {
    return { enviado: false, motivo: 'Credenciais da WhatsApp Cloud API não configuradas no servidor' };
  }

  try {
    console.log('[WhatsApp] Enviando template', { destinoFinal: numero, phoneNumberId, apiVersion, template: payload?.template?.name, parametros: payload?.template?.components?.[0]?.parameters?.length || 0 });
    const resposta = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) {
      console.error('[WhatsApp] Meta rejeitou a mensagem:', JSON.stringify(dados));
      return {
        enviado: false,
        motivo: dados?.error?.error_user_msg || dados?.error?.message || 'Falha na API do WhatsApp',
        codigo: dados?.error?.code
      };
    }

    const messageId = dados?.messages?.[0]?.id;
    return messageId
      ? (console.log('[WhatsApp] Mensagem aceita pela Meta:', messageId), { enviado: true, messageId })
      : { enviado: false, motivo: 'A Meta não retornou o ID da mensagem.' };
  } catch (erro) {
    console.error('Erro ao enviar WhatsApp:', erro.message);
    return { enviado: false, motivo: erro.message || 'Erro de conexão com a API do WhatsApp' };
  }
}

function montarTemplate({ numero, nome, idioma, parametros }) {
  return {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: numero, type: 'template',
    template: {
      name: nome,
      language: { code: idioma || 'pt_BR' },
      components: [{ type: 'body', parameters: parametros.map(parametroTexto) }]
    }
  };
}

async function enviarNotificacaoAgendamento({ destino, agendamento, servicoNome, servicoPreco, produtosResumo = 'Nenhum' }) {
  const numero = limparNumero(destino);
  if (!numero) return { enviado: false, motivo: 'WhatsApp de notificações não configurado' };

  const templateName = String(process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const idioma = String(process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR').trim();
  const todosParametros = [
    agendamento.cliente || '-', servicoNome || 'Serviço', formatarDataBR(agendamento.data),
    String(agendamento.hora || '').substring(0, 5), limparNumero(agendamento.whatsapp) || agendamento.whatsapp || '-',
    formatarValor(servicoPreco), produtosResumo || 'Nenhum'
  ];
  const quantidade = Math.max(0, Math.min(7, Number(process.env.WHATSAPP_TEMPLATE_PARAM_COUNT || 7)));
  const parametros = todosParametros.slice(0, quantidade);

  if (!templateName) return { enviado: false, motivo: 'WHATSAPP_TEMPLATE_NAME não configurado' };

  const templateResolvido = await resolverTemplateMeta(templateName, idioma);
  const payload = montarTemplate({
    numero,
    nome: templateResolvido.nome,
    idioma: templateResolvido.idioma,
    parametros
  });

  const primeiraTentativa = await enviarPayloadWhatsApp({ numero, payload });

  if (!primeiraTentativa.enviado && Number(primeiraTentativa.codigo) === 132001) {
    const novaResolucao = await resolverTemplateMeta(templateName, idioma);
    if (novaResolucao.nome !== templateResolvido.nome || novaResolucao.idioma !== templateResolvido.idioma) {
      return enviarPayloadWhatsApp({
        numero,
        payload: montarTemplate({
          numero,
          nome: novaResolucao.nome,
          idioma: novaResolucao.idioma,
          parametros
        })
      });
    }
  }

  return primeiraTentativa;
}

async function enviarConfirmacaoCliente({ destino, empresaNome, agendamento, servicoNome }) {
  const numero = limparNumero(destino);
  const templateName = String(process.env.WHATSAPP_TEMPLATE_CLIENTE_CONFIRMACAO || '').trim();
  if (!numero || !templateName) return { enviado: false, motivo: 'Template de confirmação do cliente não configurado' };

  const parametros = [
    agendamento.cliente || '-', empresaNome || 'Agenda Fácil', servicoNome || 'Serviço',
    formatarDataBR(agendamento.data), String(agendamento.hora || '').substring(0, 5)
  ];
  return enviarPayloadWhatsApp({
    numero,
    payload: montarTemplate({ numero, nome: templateName, idioma: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'pt_BR', parametros })
  });
}

module.exports = { enviarNotificacaoAgendamento, enviarConfirmacaoCliente, statusConfiguracao, limparNumero };
