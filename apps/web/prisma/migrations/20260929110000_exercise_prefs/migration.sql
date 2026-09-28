-- Montaje por ejercicio (carga por lado, peso de la barra) que la persona
-- confirma una vez y la app recuerda.
ALTER TABLE "profiles" ADD COLUMN "exercise_prefs" JSONB;
