(async function () {
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const key = params.get('pedido');
  const proof = params.get('comprobante');
  const request = {key, proof};
  const orderId = params.get('order_id');

  let busy = false;

  if (/^ORD[0-9A-HJKMNP-TV-Z]{26}$/.test(orderId || '')) {
    request.orderId = orderId;
  }

  const messages = {
    confirming: [
      'Estamos confirmando tu compra.',
      'Mercado Pago informó el pago. Estamos esperando su notificación para confirmar el pedido. No vuelvas a pagar.'
    ],
    approved: [
      '¡Gracias por tu compra!',
      'Mercado Pago confirmó tu pago. Podés escribirnos por WhatsApp con tu número de pedido para consultar la preparación o coordinar la entrega.'
    ],
    awaiting: [
      'Tu selección está reservada.',
      'Todavía no recibimos un pago. Podés continuar en Mercado Pago mientras el enlace esté vigente.'
    ],
    creating: [
      'Estamos preparando tu pago.',
      'Consultá nuevamente en unos segundos para recuperar tu enlace.'
    ],
    uncertain: [
      'Estamos verificando el enlace.',
      'Conservamos tu selección. Consultá nuevamente; no hace falta crear otra compra.'
    ],
    pending: [
      'Tu pago está pendiente.',
      'Esperá la confirmación de Mercado Pago. No vuelvas a pagar.'
    ],
    in_process: [
      'Tu pago está en revisión.',
      'Mercado Pago está procesando el pago. Consultá el estado nuevamente más tarde.'
    ],
    rejected: [
      'El pago fue rechazado.',
      'Mercado Pago no aprobó ese intento. Si el enlace está vigente, podés continuar y elegir otro medio.'
    ],
    cancelled: [
      'El pago se canceló.',
      'No se confirmó el cobro. Podés continuar si el enlace sigue vigente.'
    ],
    expired: [
      'Esta orden de pago se cerró.',
      'La reserva se liberó. Volvé a la colección para consultar disponibilidad antes de iniciar otra compra.'
    ],
    refunded: [
      'El pago fue devuelto.',
      'Contactá a la tienda para consultar los detalles de la devolución.'
    ],
    charged_back: [
      'Tu pago necesita revisión.',
      'Contactá a la tienda para revisar el estado del cobro.'
    ]
  };

  async function api(path, options) {
    const response = await fetch(path, {
      ...options,
      cache: 'no-store'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'No pudimos consultar el pago.');
    }

    return data;
  }

  function show(data) {
    if (data.retryAllowed) {
      try {
        sessionStorage.removeItem('azul-checkout-request');
      } catch {}
    }

    let copy = messages[data.paymentStatus] || [
      'Tu pago necesita revisión.',
      'Consultá a la tienda antes de volver a pagar.'
    ];

    if (data.review) {
      copy = [
        'Recibimos tu pago y estamos revisando el pedido.',
        'La tienda debe verificar el cobro y la disponibilidad antes de confirmar la entrega. No pagues nuevamente.'
      ];
    }

    if (
      data.paymentStatus === 'approved' &&
      !data.paid &&
      !data.review
    ) {
      copy = [
        'Estamos verificando tu pedido.',
        'Esperá la confirmación de la tienda antes de volver a pagar.'
      ];
    }

    $('paymentTitle').textContent = copy[0];
    $('paymentMessage').textContent = copy[1];
    $('paymentSummary').textContent =
      data.code + ' · ' +
      new Intl.NumberFormat('es-AR', {
        style: 'currency',
        currency: 'ARS'
      }).format(data.total);

    const approved =
      data.paymentStatus === 'approved' &&
      data.paid === true &&
      !data.review;

    $('checkPayment').hidden = approved;
    $('checkPayment').textContent = 'Actualizar estado del pago';

    const contact = $('contactOrder');

    if (contact) {
      contact.hidden = true;
      contact.removeAttribute('href');

      const phone = String(
        window.AzulContactInfo?.whatsapp || ''
      ).replace(/\D/g, '');

      if (approved && /^\d{8,15}$/.test(phone)) {
        const message =
          `Hola, quisiera consultar el estado de mi pedido ${data.code} ` +
          'y coordinar la entrega o el retiro.';

        contact.href =
          `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

        contact.hidden = false;
      }
    }

    let paymentUrl = null;

    try {
      const url = new URL(data.url);

      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        [
          'www.mercadopago.com.ar',
          'mercadopago.com.ar',
          'www.mercadopago.com'
        ].includes(url.hostname)
      ) {
        paymentUrl = url.href;
      }
    } catch {}

    $('resumePayment').hidden = approved || !paymentUrl;
    $('resumePayment').removeAttribute('href');

    if (paymentUrl && !approved) {
      $('resumePayment').href = paymentUrl;
    }

    if (data.paid) {
      try {
        const last = JSON.parse(
          sessionStorage.getItem('azul-last-checkout')
        );

        const current = JSON.parse(
          localStorage.getItem('elizabet-cart-v2') || '[]'
        );

        if (
          typeof last?.back === 'string' &&
          last.back.includes(key) &&
          JSON.stringify(current) === JSON.stringify(last.items)
        ) {
          localStorage.removeItem('elizabet-cart-v2');
        }

        sessionStorage.removeItem('azul-checkout-request');
      } catch {}
    }
  }

  async function check(verify = true) {
    if (busy) return;

    busy = true;
    $('checkPayment').disabled = true;
    $('paymentError').textContent = '';

    try {
      const path = verify
        ? '/api/checkout/verify'
        : '/api/checkout/status?' +
          new URLSearchParams({key, proof});

      const options = verify
        ? {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(request)
          }
        : undefined;

      show(await api(path, options));
    } catch (error) {
      $('paymentError').textContent = error.message;
    } finally {
      busy = false;
      $('checkPayment').disabled = false;
    }
  }

  $('checkPayment').onclick = () => check();

  if (!key || !proof) {
    $('paymentTitle').textContent = 'Abrí el comprobante de tu compra.';
    $('paymentMessage').textContent =
      'Volvé desde Mercado Pago al finalizar, o usá el enlace que guardó tu navegador.';

    $('checkPayment').hidden = true;

    if ($('contactOrder')) {
      $('contactOrder').hidden = true;
    }

    return;
  }

  await check(false);
  await check(true);

  // El estado de la URL de regreso no confirma un cobro.
  let ticks = 0;

  const timer = setInterval(async () => {
    if (document.hidden) return;

    if (++ticks > 6) {
      clearInterval(timer);
      return;
    }

    await check(false);
  }, 5000);
})();
