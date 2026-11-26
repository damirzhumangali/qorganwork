import React, { useEffect, useRef, useState } from 'react';
import { Image } from 'react-native';

export default function ProtectedImage({ source, onError, ...props }) {
  const [loaded, setLoaded] = useState(null);
  const onFailure = useRef(onError);
  onFailure.current = onError;
  const uri = source?.uri;
  const authorization = source?.headers?.Authorization;
  useEffect(() => {
    if (!authorization || !uri) return;
    const controller = new AbortController();
    let objectUrl;
    setLoaded(null);
    fetch(uri, { headers: { Authorization: authorization }, signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('Фото недоступно.'); return response.blob(); })
      .then(blob => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ uri: objectUrl, original: uri, authorization });
      }).catch(error => { if (error.name !== 'AbortError') onFailure.current?.(error); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [uri, authorization]);
  const resolved = authorization ? (loaded?.original === uri && loaded?.authorization === authorization ? { uri: loaded.uri } : undefined) : source;
  return <Image {...props} source={resolved} onError={onError} />;
}
